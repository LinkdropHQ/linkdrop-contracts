const ethers = require('ethers')

const erc721Mock = require( '../build/ERC721Mock')
require('dotenv').config()


const provider = new ethers.providers.JsonRpcProvider(process.env.JSON_RPC_URL)
let wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

let mock721
let linkdropFactory

const deployErc721 = async () => {
  console.log(`Deploying Linkdrop Mastercopy from ${wallet.address}...`)
  let mockContract = new ethers.ContractFactory(
    erc721Mock.abi,
    erc721Mock.bytecode,
    wallet
  )

  mock721 = await mockContract.deploy({
    gasPrice: ethers.utils.parseUnits(`${process.env.GAS_PRICE}`, 'gwei')
  })

  console.log(`ERC721 tx hash: ${mock721.deployTransaction.hash}`)
  
  await mock721.deployed()
  console.log(`Mock ERC721 contract deployed at ${mock721.address}`)

  return mock721.address
}



const deployContracts = async () => {
  const erc721Contract = await deployErc721()
  console.log("NFT contracts have been successfully deployed")
}


deployContracts().then(() => {
  process.exit(0)
}).catch((err) => {
  console.log("Error occured while deploying contracts")
  console.log(err)
})
