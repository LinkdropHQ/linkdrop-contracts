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
import ERC721Mock from '../build/ERC721Mock'

import {
  computeProxyAddress,
  createLink,
  signReceiverAddress,
  computeBytecode
} from '../scripts/utils'

const ethers = require('ethers')

chai.use(solidity)
const { expect } = chai

let provider = new MockProvider()

let [linkdropMaster, receiver, nonsender, linkdropSigner, relayer] = provider.getWallets()

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
let bytecode
let feeManager
let sponsorshipFee
let claimerFee

const initcode = '0x6352c7420d6000526103ff60206004601c335afa6040516060f3'
const chainId = 4 // Rinkeby
const campaignId = 0
const DEFAULT_TRANSFER_PATTERN = 0
const MINT_ON_CLAIM_PATTERN = 1


describe('ETH/ERC721 linkdrop tests', () => {
  
  before(async () => {    
    nftInstance = await deployContract(linkdropMaster, ERC721Mock, [], { gasLimit: 5000000 })
    await nftInstance.safeMint(linkdropMaster.address); 
    weiAmount = 0
    nftAddress = nftInstance.address
    tokenId = 1
    expirationTime = 11234234223
    version = 1    
  })    
  
  it("deploys mastercopy", async () => {
    const uri = await nftInstance.tokenURI(1);    
    masterCopy = await deployContract(linkdropMaster, LinkdropMastercopy, [], {
      gasLimit: 6000000
    })
  })

  it("deploys factory", async () => {     
    bytecode = computeBytecode(masterCopy.address)
    factory = await deployContract(
      linkdropMaster,
      LinkdropFactory,
      [masterCopy.address, chainId],
      {
        gasLimit: 6000000
      }
    )

    const feeManagerAddress = await factory.feeManager()
    feeManager = new ethers.Contract(
      feeManagerAddress,
      FeeManager.abi,
      linkdropMaster
    )
    sponsorshipFee = await feeManager.fee()
    claimerFee = await feeManager.claimerFee()
  })

  it("deploys proxy", async () => {     
    proxyAddress = computeProxyAddress(
      factory.address,
      linkdropMaster.address,
      campaignId,
      initcode
    )
    
    await factory.deployProxyWithSigner(campaignId, linkdropSigner.address, DEFAULT_TRANSFER_PATTERN, {
      gasLimit: 6000000,
      value: ethers.utils.parseUnits('100')
    })

    proxy = new ethers.Contract(
      proxyAddress,
      LinkdropMastercopy.abi,
      linkdropMaster
    )
  }) 
  
  it("gives permission to the proxy contract", async () => {
    await nftInstance.setApprovalForAll(proxy.address, true)     
  })
  
  it('creates new link key and verifies its signature', async () => {
    let senderAddr = await proxy.linkdropMaster()
    expect(linkdropMaster.address).to.eq(senderAddr)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    expect(
      await proxy.verifyLinkdropSignerSignatureERC721(
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        link.linkId,
        link.linkdropSignerSignature
      )
    ).to.be.true
  })

  it('signs receiver address with link key and verifies this signature onchain', async () => {
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    expect(
      await proxy.verifyReceiverSignatureERC721(
        link.linkId,
        receiverAddress,
        receiverSignature
      )
    ).to.be.true
  })


  it('linkdropMaster should be able to cancel link', async () => {
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    await expect(proxy.cancel(link.linkId, { gasLimit: 200000 })).to.emit(
      proxy,
      'Canceled'
    )
    let canceled = await proxy.isCanceledLink(link.linkId)
    expect(canceled).to.eq(true)
  })

  it('should fail to claim nft when paused', async () => {
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
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
      factory.checkClaimParamsERC721(
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature
      )
    ).to.be.revertedWith('LINKDROP_PROXY_CONTRACT_PAUSED')

    // Unpause for the next tssts
    await proxy.unpause({ gasLimit: 500000 })    
  })


  it('should fail to claim nft by expired link', async () => {
    // Approving all tokens from linkdropMaster to Linkdrop Contract
    await nftInstance.setApprovalForAll(proxy.address, true)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      0,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    let invalidVersion = 0
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      invalidVersion,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    let invalidChainId = 0
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      invalidChainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    const unavailableTokenId = 2
    await nftInstance.safeMint(nonsender.address);
    
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      unavailableTokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
    
    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        unavailableTokenId,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 500000 }
      )
    ).to.be.revertedWith('ERC721: transfer caller is not owner nor approved')
  })

  it('should succesfully claim nft with valid claim params', async () => {
    const feeReceiver = await feeManager.feeReceiver()
    let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
    let proxyBalanceBefore = await provider.getBalance(proxyAddress)
    
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await factory.claimERC721(
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      link.linkId,
      linkdropMaster.address,
      campaignId,
      link.linkdropSignerSignature,
      receiverAddress,
      receiverSignature,
      { gasLimit: 800000 }
    )

    const owner = await nftInstance.ownerOf(tokenId)
    expect(owner).to.eq(receiverAddress)

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
    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    await nftInstance.safeMint(linkdropMaster.address);
    tokenId = 3

    let wallet = ethers.Wallet.createRandom()
    let linkId = wallet.address

    let message = ethers.utils.solidityKeccak256(['address'], [linkId])
    let messageToSign = ethers.utils.arrayify(message)
    let fakeSignature = await receiver.signMessage(messageToSign)

    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    let fakeLink = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
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
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await proxy.cancel(link.linkId, { gasLimit: 100000 })

    await expect(
      factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
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
    tokenId = 3
    // Send ethers to Linkdrop contract
    let tx = {
      to: proxy.address,
      value: ethers.utils.parseUnits('1')
    }
    await linkdropMaster.sendTransaction(tx)

    link = await createLink(
      linkdropSigner,
      15, // weiAmount
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await factory.claimERC721(
      15, // weiAmount
      nftAddress,
      tokenId,
      expirationTime,
      link.linkId,
      linkdropMaster.address,
      campaignId,
      link.linkdropSignerSignature,
      receiverAddress,
      receiverSignature,
      { gasLimit: 800000 }
    )

    let owner = await nftInstance.ownerOf(tokenId)
    expect(owner).to.eq(receiverAddress)

    let receiverEthBalance = await provider.getBalance(receiverAddress)
    expect(receiverEthBalance).to.eq(15)
  })


  it('should succesfully claim nft when not sponsored', async () => {    
    await nftInstance.safeMint(linkdropMaster.address);    
    tokenId = 4
    const feeReceiver = await feeManager.feeReceiver()
    let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
    let proxyBalanceBefore = await provider.getBalance(proxyAddress)
    let receiverBalanceBefore = await provider.getBalance(receiver.address)    
    
    link = await createLink(
      linkdropSigner,
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    
    receiverAddress = receiver.address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
    factory = factory.connect(receiver)
    
    await factory.claimERC721(
      weiAmount,
      nftAddress,
      tokenId,
      expirationTime,
      link.linkId,
      linkdropMaster.address,
      campaignId,
      link.linkdropSignerSignature,
      receiverAddress,
      receiverSignature,
      {
        gasLimit: 800000,
        from: receiver.address,
        value: claimerFee
      }
    )

    const owner = await nftInstance.ownerOf(tokenId)
    expect(owner).to.eq(receiverAddress)

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
      await nftInstance.safeMint(linkdropMaster.address);    
      tokenId = 5
      
      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      let receiverBalanceBefore = await provider.getBalance(receiver.address)    
      
      link = await createLink(
        linkdropSigner,
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )
      
      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
      factory = factory.connect(linkdropMaster)
      
      await factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        {
          gasLimit: 800000
        }
      )

      const owner = await nftInstance.ownerOf(tokenId)
      expect(owner).to.eq(receiverAddress)

      // fees should not be transferred 
      let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
      let proxyBalanceAfter = await provider.getBalance(proxyAddress)
      let receiverBalanceAfter = await provider.getBalance(receiver.address)    
      
      expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(0)
      expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(0)
      expect(receiverBalanceBefore.sub(receiverBalanceAfter)).to.eq(0)
    }) 
    
    it('should not allow to claim without sponsorship if tx value is not matched with fee', async () => {    
      await nftInstance.safeMint(linkdropMaster.address);    
      tokenId = 6
      
      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      let receiverBalanceBefore = await provider.getBalance(receiver.address)    
      
      link = await createLink(
        linkdropSigner,
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )
      
      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
      factory = factory.connect(receiver)
      
      await expect(factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        {
          gasLimit: 800000,
          from: receiver.address,
          value: claimerFee
        }
      )).to.be.revertedWith("TX_VALUE_FEE_MISMATCH")
    })

    
    it('should succesfully claim without sponsorship', async () => {    
      tokenId = 6
      
      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      let receiverBalanceBefore = await provider.getBalance(receiver.address)    
      
      link = await createLink(
        linkdropSigner,
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )
      
      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
      factory = factory.connect(receiver)
      
      await factory.claimERC721(
        weiAmount,
        nftAddress,
        tokenId,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        {
          gasLimit: 800000,
          from: receiver.address
        }
      )

      const owner = await nftInstance.ownerOf(tokenId)
      expect(owner).to.eq(receiverAddress)

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
