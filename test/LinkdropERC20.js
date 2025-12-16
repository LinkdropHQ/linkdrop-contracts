import chai from 'chai'

import {
  MockProvider,
  deployContract,
  solidity
} from 'ethereum-waffle'

import LinkdropFactory from '../build/LinkdropFactory'
import FeeManager from '../build/FeeManager'
import LinkdropMastercopy from '../build/LinkdropMastercopy'
import ERC20Mock from '../build/ERC20Mock'

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
let tokenInstance

let link
let receiverAddress
let receiverSignature
let weiAmount
let tokenAddress
let tokenAmount
let expirationTime
let version
let bytecode

const campaignId = 0
let feeManager
let sponsorshipFee
let claimerFee


const initcode = '0x6352c7420d6000526103ff60206004601c335afa6040516060f3'
const chainId = 4 // Rinkeby
const DEFAULT_TRANSFER_PATTERN = 0
const MINT_ON_CLAIM_PATTERN = 1


describe('ETH/ERC20 linkdrop tests', () => {
  before(async () => {
    tokenInstance = await deployContract(linkdropMaster, ERC20Mock)
    await tokenInstance.mint(linkdropMaster.address, "100000000000000")
  })

  it('deploy master copy of linkdrop implementation', async () => {
    masterCopy = await deployContract(linkdropMaster, LinkdropMastercopy, [], {
      gasLimit: 6000000
    })
    expect(masterCopy.address).to.not.eq(ethers.constants.AddressZero)
  })

  it('should deploy factory', async () => {
    bytecode = computeBytecode(masterCopy.address)
    factory = await deployContract(
      linkdropMaster,
      LinkdropFactory,
      [masterCopy.address, chainId],
      {
        gasLimit: 6000000
      }      
    )

    expect(factory.address).to.not.eq(ethers.constants.AddressZero)
    let version = await factory.masterCopyVersion()
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

  it('should deploy proxy and delegate to implementation', async () => {
    // Compute next address with js function
    proxyAddress = computeProxyAddress(
      factory.address,
      linkdropMaster.address,
      campaignId,
      initcode
    )

    await expect(
      factory.deployProxy(campaignId, DEFAULT_TRANSFER_PATTERN, {
        gasLimit: 6000000,
        value: ethers.utils.parseUnits('100')        
      })
    ).to.emit(factory, 'Deployed')

    proxy = new ethers.Contract(
      proxyAddress,
      LinkdropMastercopy.abi,
      linkdropMaster
    )

    
    let linkdropMasterAddress = await proxy.linkdropMaster()
    expect(linkdropMasterAddress).to.eq(linkdropMaster.address)

    let version = await proxy.version()
    expect(version).to.eq(1)

    let owner = await proxy.factory()
    expect(owner).to.eq(factory.address)

    await linkdropMaster.sendTransaction({
      to: proxy.address,
      value: ethers.utils.parseEther('2')
    })
  })

  it('linkdropMaster should be able to add new signing keys', async () => {
    let isSigner = await proxy.isLinkdropSigner(linkdropSigner.address)
    expect(isSigner).to.eq(false)
    await proxy.addSigner(linkdropSigner.address, { gasLimit: 500000 })
    isSigner = await proxy.isLinkdropSigner(linkdropSigner.address)
    expect(isSigner).to.eq(true)

    await proxy.addSigner(receiver.address, { gasLimit: 500000 })
  })


  it('should revert while checking claim params with insufficient allowance', async () => {
    weiAmount = 0
    tokenAddress = tokenInstance.address
    tokenAmount = 100
    expirationTime = 11234234223
    version = 1
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.checkClaimParams(
        weiAmount,
        tokenAddress,
        tokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature
      )
    ).to.be.revertedWith('INSUFFICIENT_ALLOWANCE')
  })

  it('creates new link key and verifies its signature', async () => {
    let senderAddr = await proxy.linkdropMaster()
    expect(linkdropMaster.address).to.eq(senderAddr)

    expect(
      await proxy.verifyLinkdropSignerSignature(
        weiAmount,
        tokenAddress,
        tokenAmount,
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
      tokenAddress,
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
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
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
    let canceled = await proxy.isCanceledLink(link.linkId)
    expect(canceled).to.eq(true)
  })

  it('should fail to claim tokens when paused', async () => {
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
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
      factory.checkClaimParams(
        weiAmount,
        tokenAddress,
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
  })

  it('should fail to claim with insufficient allowance', async () => {
    factory = factory.connect(relayer)

    // Unpause
    await proxy.unpause({ gasLimit: 500000 })

    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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
    ).to.be.revertedWith('INSUFFICIENT_ALLOWANCE')
  })

  it('should fail to claim tokens by expired link', async () => {
    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      0,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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

  it('should fail to claim with invalid contract version', async () => {
    const invalidVersion = 0

    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      invalidVersion,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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

  it('should fail to claim with invalid chain id', async () => {
    const invalidChainId = 0
    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      invalidChainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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

  it('should successfully claim tokens with valid claim params', async () => {    
    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    const feeReceiver = await feeManager.feeReceiver()
    let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
    let proxyBalanceBefore = await provider.getBalance(proxyAddress)
    
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    let approverBalanceBefore = await tokenInstance.balanceOf(
      linkdropMaster.address
    )

    await factory.claim(
      weiAmount,
      tokenAddress,
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

    let approverBalanceAfter = await tokenInstance.balanceOf(
      linkdropMaster.address
    )
    expect(approverBalanceAfter).to.eq(approverBalanceBefore.sub(tokenAmount))

    let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
    expect(receiverTokenBalance).to.eq(tokenAmount)

    // fees should be transferred from proxy address to receiving fee account
    let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
    let proxyBalanceAfter = await provider.getBalance(proxyAddress)

    expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(sponsorshipFee)
    expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(sponsorshipFee)    
  })

  
  it('should be able to check link claimed from factory instance', async () => {
    let claimed = await factory.isClaimedLink(
      linkdropMaster.address,
      campaignId,
      link.linkId
    )
    expect(claimed).to.eq(true)
  })

  it('should fail to claim link twice', async () => {
    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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

  it('should fail to claim unavailable amount of tokens', async () => {
    const unavailableAmountOfTokens = 1000000000000

    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      unavailableAmountOfTokens,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
        unavailableAmountOfTokens,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 800000 }
      )
    ).to.be.revertedWith('INSUFFICIENT_ALLOWANCE')
  })

  it('should fail to claim tokens with fake linkdropMaster signature', async () => {
    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    let wallet = ethers.Wallet.createRandom()
    let linkId = wallet.address

    let message = ethers.utils.solidityKeccak256(['address'], [linkId])
    let messageToSign = ethers.utils.arrayify(message)
    let fakeSignature = await receiver.signMessage(messageToSign)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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

  it('should fail to claim tokens with fake receiver signature', async () => {
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    let fakeLink = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
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
      factory.claim(
        weiAmount,
        tokenAddress,
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

  it('should fail to claim tokens by canceled link', async () => {
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
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
      factory.claim(
        weiAmount,
        tokenAddress,
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


  it('should succesully claim ethers only', async () => {
    weiAmount = 100 // wei
    tokenAmount = 0
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )
    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    await expect(
      factory.claim(
        weiAmount,
        tokenAddress,
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
    ).to.emit(proxy, 'Claimed')
  })

  it('should succesfully claim tokens and ethers simultaneously', async () => {
    weiAmount = 15 // wei
    tokenAmount = 20

    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, 20)

    // Send ethers to Linkdrop contract
    let tx = {
      to: proxy.address,
      value: ethers.utils.parseEther('2')
    }
    await linkdropMaster.sendTransaction(tx)

    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = ethers.Wallet.createRandom().address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

    let proxyEthBalanceBefore = await provider.getBalance(proxy.address)
    let approverTokenBalanceBefore = await tokenInstance.balanceOf(
      linkdropMaster.address
    )

    await factory.claim(
      weiAmount,
      tokenAddress,
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

    let proxyEthBalanceAfter = await provider.getBalance(proxy.address)
    expect(proxyEthBalanceAfter).to.eq(
      proxyEthBalanceBefore.sub(weiAmount).sub(sponsorshipFee)
    )

    let approverTokenBalanceAfter = await tokenInstance.balanceOf(
      linkdropMaster.address
    )
    expect(approverTokenBalanceAfter).to.eq(
      approverTokenBalanceBefore.sub(tokenAmount)
    )

    let receiverEthBalance = await provider.getBalance(receiverAddress)
    expect(receiverEthBalance).to.eq(weiAmount)

    let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
    expect(receiverTokenBalance).to.eq(tokenAmount)

    weiAmount = 0
  })

  it('should successfully claim tokens when not sponsored', async () => {    
    // Approving tokens from linkdropMaster to Linkdrop Contract
    await tokenInstance.approve(proxy.address, tokenAmount)

    const feeReceiver = await feeManager.feeReceiver()
    let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
    let proxyBalanceBefore = await provider.getBalance(proxyAddress)
    let receiverBalanceBefore = await provider.getBalance(receiver.address)
    
    link = await createLink(
      linkdropSigner,
      weiAmount,
      tokenAddress,
      tokenAmount,
      expirationTime,
      version,
      chainId,
      proxyAddress
    )

    receiverAddress = receiver.address
    receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
    proxy = proxy.connect(receiver)

    let approverBalanceBefore = await tokenInstance.balanceOf(
      linkdropMaster.address
    )

    await proxy.claim(
      weiAmount,
      tokenAddress,
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

    let approverBalanceAfter = await tokenInstance.balanceOf(
      linkdropMaster.address
    )
    expect(approverBalanceAfter).to.eq(approverBalanceBefore.sub(tokenAmount))

    let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
    expect(receiverTokenBalance).to.eq(tokenAmount)

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
      // Approving tokens from linkdropMaster to Linkdrop Contract
      await tokenInstance.approve(proxy.address, tokenAmount)

      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      
      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        tokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = ethers.Wallet.createRandom().address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      let approverBalanceBefore = await tokenInstance.balanceOf(
        linkdropMaster.address
      )

      factory = factory.connect(linkdropMaster)
      
      await factory.claim(
        weiAmount,
        tokenAddress,
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

      let approverBalanceAfter = await tokenInstance.balanceOf(
        linkdropMaster.address
      )
      expect(approverBalanceAfter).to.eq(approverBalanceBefore.sub(tokenAmount))

      let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
      expect(receiverTokenBalance).to.eq(tokenAmount)

      // fees should be transferred from proxy address to receiving fee account
      let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
      let proxyBalanceAfter = await provider.getBalance(proxyAddress)

      expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(0)
      expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(0)         
    })


    it('should not allow to claim without sponsorship if tx value is not matched with fee', async () => {
      // Approving tokens from linkdropMaster to Linkdrop Contract
      await tokenInstance.approve(proxy.address, tokenAmount)
      
      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        tokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
      proxy = proxy.connect(receiver)

      let approverBalanceBefore = await tokenInstance.balanceOf(
        linkdropMaster.address
      )

      const txValue = claimerFee.gt(0) ? claimerFee : ethers.utils.parseUnits('1')        
      await expect(proxy.claim(
        weiAmount,
        tokenAddress,
        tokenAmount,
        expirationTime,
        link.linkId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        {
          gasLimit: 800000,
          value: txValue
        }
      )).to.be.revertedWith("TX_VALUE_FEE_MISMATCH")

    })

    it('should succesfully claim without sponsorship', async () => {
      // Approving tokens from linkdropMaster to Linkdrop Contract
      await tokenInstance.approve(proxy.address, tokenAmount)

      const feeReceiver = await feeManager.feeReceiver()
      let feeReceiverBalanceBefore = await provider.getBalance(feeReceiver)
      let proxyBalanceBefore = await provider.getBalance(proxyAddress)
      let receiverBalanceBefore = await provider.getBalance(receiver.address)
      
      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        tokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = receiver.address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)
      proxy = proxy.connect(receiver)

      let approverBalanceBefore = await tokenInstance.balanceOf(
        linkdropMaster.address
      )

      let receiverTokenBalanceBefore = await tokenInstance.balanceOf(receiverAddress)
      
      await proxy.claim(
        weiAmount,
        tokenAddress,
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

      let approverBalanceAfter = await tokenInstance.balanceOf(
        linkdropMaster.address
      )
      expect(approverBalanceAfter).to.eq(approverBalanceBefore.sub(tokenAmount))

      let receiverTokenBalanceAfter = await tokenInstance.balanceOf(receiverAddress)
      expect(receiverTokenBalanceAfter.sub(receiverTokenBalanceBefore)).to.eq(tokenAmount)

      // fees should be transferred from proxy address to receiving fee account
      let feeReceiverBalanceAfter = await provider.getBalance(feeReceiver)
      let proxyBalanceAfter = await provider.getBalance(proxyAddress)
      
      expect(proxyBalanceBefore.sub(proxyBalanceAfter)).to.eq(0)
      expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.eq(0)
    })
  })

  describe("Forced Token Amount Feature", () => {
    before(async () => {
      // Reset proxy connection to linkdropMaster
      proxy = proxy.connect(linkdropMaster)
    })

    it('should have forced token amount set to 0 by default', async () => {
      const forcedAmount = await proxy.forcedTokenAmount()
      expect(forcedAmount).to.eq(0)
    })

    it('should allow owner to set forced token amount', async () => {
      const forcedAmount = 500
      await expect(
        proxy.setForcedTokenAmount(forcedAmount, { gasLimit: 200000 })
      ).to.emit(proxy, 'ForcedTokenAmountUpdated').withArgs(forcedAmount)

      const newForcedAmount = await proxy.forcedTokenAmount()
      expect(newForcedAmount).to.eq(forcedAmount)
    })

    it('should fail to set forced token amount from non-owner', async () => {
      const nonOwnerProxy = proxy.connect(receiver)
      await expect(
        nonOwnerProxy.setForcedTokenAmount(1000, { gasLimit: 200000 })
      ).to.be.reverted
    })

    it('should claim with forced token amount instead of link amount', async () => {
      const linkTokenAmount = 100
      const forcedAmount = 250

      // Set forced amount
      await proxy.setForcedTokenAmount(forcedAmount, { gasLimit: 200000 })

      // Approve enough tokens for forced amount
      await tokenInstance.approve(proxy.address, forcedAmount)

      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        linkTokenAmount, // Link specifies 100
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = ethers.Wallet.createRandom().address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      let approverBalanceBefore = await tokenInstance.balanceOf(
        linkdropMaster.address
      )

      await factory.claim(
        weiAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 800000 }
      )

      let approverBalanceAfter = await tokenInstance.balanceOf(
        linkdropMaster.address
      )
      // Should transfer forced amount (250), not link amount (100)
      expect(approverBalanceAfter).to.eq(approverBalanceBefore.sub(forcedAmount))

      let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
      expect(receiverTokenBalance).to.eq(forcedAmount)
    })

    it('should verify that claim event emits forced amount', async () => {
      const linkTokenAmount = 75
      const forcedAmount = 300

      // Set new forced amount
      await proxy.setForcedTokenAmount(forcedAmount, { gasLimit: 200000 })

      // Approve enough tokens
      await tokenInstance.approve(proxy.address, forcedAmount)

      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = ethers.Wallet.createRandom().address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      // Check that Claimed event emits the forced amount
      await expect(
        factory.claim(
          weiAmount,
          tokenAddress,
          linkTokenAmount,
          expirationTime,
          link.linkId,
          linkdropMaster.address,
          campaignId,
          link.linkdropSignerSignature,
          receiverAddress,
          receiverSignature,
          { gasLimit: 800000 }
        )
      ).to.emit(proxy, 'Claimed')
      
      // Verify receiver got forced amount
      let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
      expect(receiverTokenBalance).to.eq(forcedAmount)
    })

    it('should fail if insufficient allowance for forced amount', async () => {
      const linkTokenAmount = 50
      const forcedAmount = 1000

      // Set high forced amount
      await proxy.setForcedTokenAmount(forcedAmount, { gasLimit: 200000 })

      // Approve only link amount (insufficient for forced amount)
      await tokenInstance.approve(proxy.address, linkTokenAmount)

      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = ethers.Wallet.createRandom().address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      await expect(
        factory.claim(
          weiAmount,
          tokenAddress,
          linkTokenAmount,
          expirationTime,
          link.linkId,
          linkdropMaster.address,
          campaignId,
          link.linkdropSignerSignature,
          receiverAddress,
          receiverSignature,
          { gasLimit: 800000 }
        )
      ).to.be.revertedWith('INSUFFICIENT_ALLOWANCE')
    })

    it('should respect link amount when forced amount is set to 0', async () => {
      const linkTokenAmount = 150

      // Disable forced amount
      await proxy.setForcedTokenAmount(0, { gasLimit: 200000 })

      // Approve link amount
      await tokenInstance.approve(proxy.address, linkTokenAmount)

      link = await createLink(
        linkdropSigner,
        weiAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = ethers.Wallet.createRandom().address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      let approverBalanceBefore = await tokenInstance.balanceOf(
        linkdropMaster.address
      )

      await factory.claim(
        weiAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 800000 }
      )

      let approverBalanceAfter = await tokenInstance.balanceOf(
        linkdropMaster.address
      )
      // Should transfer link amount (150), not forced amount (0)
      expect(approverBalanceAfter).to.eq(approverBalanceBefore.sub(linkTokenAmount))

      let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
      expect(receiverTokenBalance).to.eq(linkTokenAmount)
    })

    it('should work with forced amount and ethers simultaneously', async () => {
      const linkTokenAmount = 100
      const forcedAmount = 200
      const ethAmount = 50

      // Set forced amount
      await proxy.setForcedTokenAmount(forcedAmount, { gasLimit: 200000 })

      // Approve tokens
      await tokenInstance.approve(proxy.address, forcedAmount)

      link = await createLink(
        linkdropSigner,
        ethAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        version,
        chainId,
        proxyAddress
      )

      receiverAddress = ethers.Wallet.createRandom().address
      receiverSignature = await signReceiverAddress(link.linkKey, receiverAddress)

      let proxyEthBalanceBefore = await provider.getBalance(proxy.address)
      let approverTokenBalanceBefore = await tokenInstance.balanceOf(
        linkdropMaster.address
      )

      await factory.claim(
        ethAmount,
        tokenAddress,
        linkTokenAmount,
        expirationTime,
        link.linkId,
        linkdropMaster.address,
        campaignId,
        link.linkdropSignerSignature,
        receiverAddress,
        receiverSignature,
        { gasLimit: 800000 }
      )

      // Verify ETH transfer
      let receiverEthBalance = await provider.getBalance(receiverAddress)
      expect(receiverEthBalance).to.eq(ethAmount)

      // Verify token transfer uses forced amount
      let approverTokenBalanceAfter = await tokenInstance.balanceOf(
        linkdropMaster.address
      )
      expect(approverTokenBalanceAfter).to.eq(
        approverTokenBalanceBefore.sub(forcedAmount)
      )

      let receiverTokenBalance = await tokenInstance.balanceOf(receiverAddress)
      expect(receiverTokenBalance).to.eq(forcedAmount)
    })

    after(async () => {
      // Reset forced amount to 0 after tests
      await proxy.setForcedTokenAmount(0, { gasLimit: 200000 })
    })
  })
})
