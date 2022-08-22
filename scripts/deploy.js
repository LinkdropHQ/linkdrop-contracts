const ethers = require('ethers')
const Factory = require('../build/LinkdropFactory')
const Linkdrop = require( '../build/LinkdropMastercopy')
require('dotenv').config()


const provider = new ethers.providers.JsonRpcProvider(process.env.JSON_RPC_URL)
let wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

let linkdropMastercopy
let linkdropFactory

const deployLinkdropMastercopy = async () => {
  console.log(`Deploying Linkdrop Mastercopy from ${wallet.address}...`)
  let linkdropContract = new ethers.ContractFactory(
    Linkdrop.abi,
    Linkdrop.bytecode,
    wallet
  )

  linkdropMastercopy = await linkdropContract.deploy({
    gasPrice: ethers.utils.parseUnits(`${process.env.GAS_PRICE}`, 'gwei')
  })

  console.log(`Mastercopy tx hash: ${linkdropMastercopy.deployTransaction.hash}`)
  
  await linkdropMastercopy.deployed()
  console.log(`Linkdrop contract deployed at ${linkdropMastercopy.address}`)

  return linkdropMastercopy.address
}

const deployFactory = async (mastercopyAddress) => {
  console.log(``)    
  console.log(`Deploying Linkdrop Factory from ${wallet.address}...`)  
  let factory = new ethers.ContractFactory(
    Factory.abi,
    Factory.bytecode,
    wallet
  )

  const { chainId } = await provider.getNetwork()  
  linkdropFactory = await factory.deploy(mastercopyAddress, chainId, {
    gasLimit: 4500000,
    gasPrice: ethers.utils.parseUnits(`${process.env.GAS_PRICE}`, 'gwei')
  })

  console.log(`Factoy deploy tx hash: ${linkdropFactory.deployTransaction.hash}`)
  
  await linkdropFactory.deployed()
  console.log(`Factory contract deployed at ${linkdropFactory.address}`)

};


const deployLinkdropContracts = async () => {
  const mastercopyAddress = await deployLinkdropMastercopy()
  await deployFactory(mastercopyAddress)
  console.log("Linkdrop contracts have been successfully deployed")
}


deployLinkdropContracts().then(() => {
  process.exit(0)
}).catch((err) => {
  console.log("Error occured while deploying contracts")
  console.log(err)
})
