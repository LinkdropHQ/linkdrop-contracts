/* global describe, before, it */
import chai from 'chai'

import {
  MockProvider,
  deployContract,
  solidity
} from 'ethereum-waffle'

import LinkdropFactory from '../build/LinkdropFactory'
import FeeManager from '../build/FeeManager'
import LinkdropMastercopy from '../build/LinkdropMastercopy'
import ERC1155Mock from '../build/ERC1155Mock'

import {
  computeProxyAddress,
  signReceiverAddress
} from '../scripts/utils'

import { createLinkForERC1155 } from '../scripts/utilsERC1155'

const ethers = require('ethers')

chai.use(solidity)
const { expect } = chai

const provider = new MockProvider()

const [linkdropMaster, receiver, nonsender, linkdropSigner, relayer] = provider.getWallets()

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
let feeManager
let sponsorshipFee
let claimerFee

const initcode = '0x6352c7420d6000526103ff60206004601c335afa6040516060f3'
const chainId = 4 // Rinkeby
const campaignId = 0
const DEFAULT_TRANSFER_PATTERN = 0
const MINT_ON_CLAIM_PATTERN = 1


describe('ERC1155 linkdrop tests', () => {
  before(async () => {
    nftInstance = await deployContract(linkdropMaster, ERC1155Mock, [], { gasLimit: 5000000 })
    await nftInstance.mintBatch(linkdropMaster.address, [1,2,3,4], [1000, 1000, 1000, 1000], "0x")

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

    const feeManagerAddress = await factory.feeManager()
    feeManager = new ethers.Contract(
      feeManagerAddress,
      FeeManager.abi,
      linkdropMaster
    )
    sponsorshipFee = await feeManager.fee()
    claimerFee = await feeManager.claimerFee()
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
      factory.deployProxyWithSigner(campaignId, linkdropSigner.address, DEFAULT_TRANSFER_PATTERN, {
        gasLimit: 6000000,
        value: ethers.utils.parseUnits('100')
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


  it('should fail to claim with insufficient allowance', async () => {
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
    ).to.be.revertedWith('ERC1155: caller is not owner nor approved')
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
    ).to.be.revertedWith('')
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
    ).to.be.revertedWith('')
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
    ).to.be.revertedWith('')
  })

  
  it('should fail to claim nft which does not belong to linkdrop master', async () => {
    const unavailableTokenId = 13
    const tokenAmount = 1

    link = await createLinkForERC1155(
      linkdropSigner,
      weiAmount,
      nftAddress,
      unavailableTokenId,
      tokenAmount,
      expirationTime,
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
        unavailableTokenId,
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
    ).to.be.revertedWith('ERC1155: insufficient balance for transfer')
  })

  it('should successfully claim nft with valid claim params', async () => {
    const feeReceiver = await feeManager.feeReceiver()
    let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
    let proxyBalanceBefore = await provider.getBalance(proxyAddress)
    
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

    // fees should be transferred from proxy address to receiving fee account
    let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
    let proxyBalanceAfter = await provider.getBalance(proxyAddress)

    expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(sponsorshipFee)
    expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(sponsorshipFee)    
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
    ).to.be.revertedWith('')
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

    weiAmount = 0
  })
  
  it('should succesfully claim nft when not sponsored', async () => {
    tokenId = 4
    const tokenAmount = 1    
    const feeReceiver = await feeManager.feeReceiver()
    let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
    let proxyBalanceBefore = await provider.getBalance(proxyAddress)
    let receiverBalanceBefore = await provider.getBalance(receiver.address)    
    
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
    
    receiverAddress = receiver.address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    proxy = proxy.connect(receiver)
    const tx = await proxy.claimERC1155(
      weiAmount,
      nftAddress,
      tokenId,
      tokenAmount,
      expirationTime,
      link.linkId,
      link.linkdropSignerSignature,
      receiverAddress,
      receiverSignature,
      {
        gasLimit: 800000,
        value: claimerFee
      }
    )
    expect(tx.from).to.eq(receiverAddress)
    
    const hasTokens = (await nftInstance.balanceOf(receiverAddress, tokenId)) > 0
    expect(hasTokens).to.eq(true)
    
    // fees should be transferred from proxy address to receiving fee account
    let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
    let proxyBalanceAfter = await provider.getBalance(proxyAddress)
    let receiverBalanceAfter = await provider.getBalance(receiver.address)    
    
    expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(0)
    expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(claimerFee)
    expect(receiverBalanceBefore.sub(receiverBalanceAfter)).to.be.gt(claimerFee)
  })

  describe("whitelisted", () => {
    before(async () => {
      await feeManager.whitelist(linkdropMaster.address)
    })

    it('should succesfully claim with sponsorship', async () => {
      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      
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

      // fees should be transferred from proxy address to receiving fee account
      let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
      let proxyBalanceAfter = await provider.getBalance(proxyAddress)

      expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(0)
      expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(0)    
    })

    it('should not allow to claim without sponsorship if tx value is not matched with fee', async () => {
      tokenId = 4
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
      
      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
      
      proxy = proxy.connect(receiver)
      await expect(proxy.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        {
          gasLimit: 800000,
          value: claimerFee
        }
      )).to.be.revertedWith("TX_VALUE_FEE_MISMATCH")
    })
    
    it('should succesfully claim without sponsorship', async () => {
      tokenId = 4
      const tokenAmount = 1    
      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      let receiverBalanceBefore = await provider.getBalance(receiver.address)    
      
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
      
      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      proxy = proxy.connect(receiver)
      const tx = await proxy.claimERC1155(
        weiAmount,
        nftAddress,
        tokenId,
        tokenAmount,
        expirationTime,
        link.linkId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        {
          gasLimit: 800000,
          value: 0
        }
      )
      expect(tx.from).to.eq(receiverAddress)
      
      const hasTokens = (await nftInstance.balanceOf(receiverAddress, tokenId)) > 0
      expect(hasTokens).to.eq(true)
      
      // fees should be transferred from proxy address to receiving fee account
      let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
      let proxyBalanceAfter = await provider.getBalance(proxyAddress)
      let receiverBalanceAfter = await provider.getBalance(receiver.address)    
      
      expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(0)
      expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(0)
      expect(receiverBalanceBefore.sub(receiverBalanceAfter)).to.be.gt(0)
    })
  })
})
