/* global describe, before, it */
import chai from 'chai'

import {
  createMockProvider,
  deployContract,
  solidity
} from 'ethereum-waffle'

import LinkdropFactory from '../build/LinkdropFactory'
import LinkdropMastercopy from '../build/LinkdropMastercopy'
import ERC1155Mock from '../build/ERC1155Mock'

import {
  computeProxyAddress,
  signReceiverAddress
} from '../scripts/utils'

import { createLinkForERC1155 } from '../scripts/utilsERC1155'

const ethers = require('ethers')

// Turn off annoying warnings
ethers.errors.setLogLevel('error')

chai.use(solidity)
const { expect } = chai

const provider = createMockProvider()

const [linkdropMaster, receiver, nonsender, linkdropSigner, relayer] = provider.getWallets(
  provider
)

let masterCopy
let factory
let proxy
let proxyAddress
let nftInstance

let link
let receiverAddress
let receiverSignature
let weiAmount
let nftAddress
let tokenId
let expirationTime
let version

const initcode = '0x6352c7420d6000526103ff60206004601c335afa6040516060f3'
const chainId = 4 // Rinkeby
const campaignId = 0
const DEFAULT_TRANSFER_PATTERN = 0
const MINT_ON_CLAIM_PATTERN = 1
const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"

describe('ERC1155 linkdrop tests for MINT TRANSFER PATTERN', () => {
  before(async () => {
    nftInstance = await deployContract(linkdropMaster, ERC1155Mock, [], { gasLimit: 5000000 })
    weiAmount = 0
    nftAddress = nftInstance.address
    tokenId = 1
    expirationTime = 11234234223
    version = 1
    const tokenAmount = 1    
  })

  it('should deploy master copy of linkdrop implementation', async () => {
    masterCopy = await deployContract(linkdropMaster, LinkdropMastercopy, [], {
      gasLimit: 6000000
    })
    expect(masterCopy.address).to.not.eq(ethers.constants.AddressZero)
  })

  it('should deploy factory', async () => {
    factory = await deployContract(
      linkdropMaster,
      LinkdropFactory,
      [masterCopy.address, chainId],
      {
        gasLimit: 6000000
      }
    )
    expect(factory.address).to.not.eq(ethers.constants.AddressZero)
    const version = await factory.masterCopyVersion()
    expect(version).to.eq(1)
  })

  it('should deploy proxy', async () => {
    // Compute next address with js function
    proxyAddress = computeProxyAddress(
      factory.address,
      linkdropMaster.address,
      campaignId,
      initcode
    )

    await expect(
      factory.deployProxyWithSigner(campaignId, linkdropSigner.address, MINT_ON_CLAIM_PATTERN, {
        gasLimit: 6000000
      })
    ).to.emit(factory, 'Deployed')

    proxy = new ethers.Contract(
      proxyAddress,
      LinkdropMastercopy.abi,
      linkdropMaster
    )
    
    const linkdropMasterAddress = await proxy.linkdropMaster()
    expect(linkdropMasterAddress).to.eq(linkdropMaster.address)

    const version = await proxy.version()
    expect(version).to.eq(1)

    const owner = await proxy.factory()
    expect(owner).to.eq(factory.address)

    await linkdropMaster.sendTransaction({
      to: proxy.address,
      value: ethers.utils.parseEther('2')
    })

    factory = factory.connect(relayer)

    // grant minter role
    await nftInstance.grantRole(MINTER_ROLE, proxy.address) 
  })



  it('creates new link key and verifies its signature', async () => {
    const senderAddress = linkdropMaster.address

    const senderAddr = await proxy.linkdropMaster()
    expect(senderAddress).to.eq(senderAddr)

    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    expect(
      await proxy.verifyLinkdropSignerSignatureERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        link.linkdropSignerSignature
      )
    ).to.be.true
  })

  it('signs receiver address with link key and verifies this signature onchain', async () => {
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    expect(
      await proxy.verifyReceiverSignature(
        link.linkId,
        receiverAddress,
        receiverSignature
      )
    ).to.be.true
  })


  it('linkdropMaster should be able to cancel link', async () => {
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    await expect(proxy.cancel(link.linkId, { gasLimit: 200000 })).to.emit(
      proxy,
      'Canceled'
    )
    const canceled = await proxy.isCanceledLink(link.linkId)
    expect(canceled).to.eq(true)
  })

  it('should fail to claim nft when paused', async () => {
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    // Pausing
    await proxy.pause({ gasLimit: 500000 })

    await expect(
      factory.checkClaimParamsERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature
      )
    ).to.be.revertedWith('LINKDROP_PROXY_CONTRACT_PAUSED')
    // Unpause
    await proxy.unpause({ gasLimit: 500000 })    
  })

  
  it('should fail to claim nft by expired link', async () => {
    // Approving all tokens from linkdropMaster to Linkdrop Contract
    await nftInstance.setApprovalForAll(proxy.address, true)

    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,      
      tokenAmount,
      0,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        0,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('LINK_EXPIRED')
  })

  it('should fail to claim nft with invalid contract version link', async () => {
    const invalidVersion = 0
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      invalidVersion,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('INVALID_LINKDROP_SIGNER_SIGNATURE')
  })

  it('should fail to claim nft with invalid chaind id', async () => {
    const invalidChainId = 0
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      invalidChainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('INVALID_LINKDROP_SIGNER_SIGNATURE')
  })

  it('should fail to claim nft with invalid tokenAmount', async () => {
    const invalidChainId = 0
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      invalidChainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('INVALID_LINKDROP_SIGNER_SIGNATURE')
  })

  it('should succesfully claim nft with valid claim params', async () => {
    const tokenAmount = 1
    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await factory.claimERC1155(
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      link.linkId,
      linkdropMaster.address,
      campaignId,
      link.linkdropSignerSignature,
      receiverAddress,
      receiverSignature,
      { gasLimit: 800000 }
    )

    const hasTokens = (await nftInstance.balanceOf(receiverAddress, tokenId)) > 0    
    expect(hasTokens).to.eq(true)
  })
  
  it('should be able to check link claimed from factory instance', async () => {
    const claimed = await factory.isClaimedLink(
      linkdropMaster.address,
      campaignId,
      link.linkId
    )
    expect(claimed).to.eq(true)
  })

  it('should fail to claim link twice', async () => {
    const tokenAmount = 1
    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('LINK_CLAIMED')
  })

  it('should fail to claim nft with fake linkdropMaster signature', async () => {
    tokenId = 2

    const wallet = ethers.Wallet.createRandom()
    const linkId = wallet.address

    const message = ethers.utils.solidityKeccak256(['address'], [linkId])
    const messageToSign = ethers.utils.arrayify(message)
    const fakeSignature = await receiver.signMessage(messageToSign)
    const tokenAmount = 1
    
    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        linkId,
        linkdropMaster.address,
        campaignId,
        fakeSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('INVALID_LINKDROP_SIGNER_SIGNATURE')
  })

  it('should fail to claim nft with fake receiver signature', async () => {
    const tokenAmount = 1
      
    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    
    const fakeLink = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(
      fakeLink.linkKey, // signing receiver address with fake link key
      receiverAddress
    )
    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('INVALID_RECEIVER_SIGNATURE')
  })

  it('should fail to claim nft by canceled link', async () => {
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await proxy.cancel(link.linkId, { gasLimit: 100000 })

    await expect(
      factory.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('LINK_CANCELED')
  })


  it('should succesfully claim eth and nft simulteneously', async () => {
    tokenId = 4

    weiAmount = 15 // wei

    // Send ethers to Linkdrop contract
    const tx = {
      to: proxy.address,
      value: ethers.utils.parseUnits('1')
    }
    await linkdropMaster.sendTransaction(tx)

    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await factory.claimERC1155(
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      link.linkId,
      linkdropMaster.address,
      campaignId,
      link.linkdropSignerSignature,
      receiverAddress,
      receiverSignature,
      { gasLimit: 800000 }
    )

    const hasTokens = (await nftInstance.balanceOf(receiverAddress, tokenId)) > 0
    expect(hasTokens).to.eq(true)

    const receiverEthBalance = await provider.getBalance(receiverAddress)
    expect(receiverEthBalance).to.eq(weiAmount)
  })
})
