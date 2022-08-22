# Linkdrop Contracts

This repo contains contracts for Linkdrop App. Linkdrop allows sending NFTs via links and QR codes.
Learn more at [Technology Overview blog post](https://medium.com/linkdrop-protocol/linkdrop-technical-description-2ec43f718924)

## Contracts Overview

There are 2 main contracts involved:
  - Linkdrop Campaign Contract (Linkdrop Mastercopy): https://github.com/LinkdropHQ/linkdrop-contracts/blob/main/contracts/linkdrop/LinkdropMastercopy.sol 
  - Linkdrop Factory: https://github.com/LinkdropHQ/linkdrop-contracts/blob/main/contracts/factory/LinkdropFactory.sol


### Linkdrop Factory

Linkdrop Factory contract deploys Linkdrop Campaign Contracts as proxies of Linkdrop Mastercopy for each campaign (based on [Minimal Proxy Contract standard (EIP-1167)](https://eips.ethereum.org/EIPS/eip-1167)).

**User-activated updgradability**  
Factrory owner can set and update Linkdrop Mastercopy contracts.

Updating Mastercopy will affect new Linkdrop Campaign contract by making them proxies of the new mastercopy.
Mastercopy update doesn't affect already deployed Linkdrop Campaign contracts by itself. However, campaign creators can destroy their contracts and redeploy the campaign contract.
New contract will become proxy of the new mastercopy.

### Linkdrop Campaign Contract

Linkdrop Campaign Contract supports claiming of:
  - ERC20 Tokens: https://github.com/LinkdropHQ/linkdrop-contracts/blob/main/contracts/linkdrop/LinkdropERC20.sol
  - ERC721 Tokens: https://github.com/LinkdropHQ/linkdrop-contracts/blob/main/contracts/linkdrop/LinkdropERC721.sol
  - ERC1155 Tokens: https://github.com/LinkdropHQ/linkdrop-contracts/blob/main/contracts/linkdrop/LinkdropERC1155.sol

Before claim Linkdrop Campaign Contract verifies that receiver provided valid signatures in accordance with the scheme described at [Technology Overview blog post](https://medium.com/linkdrop-protocol/linkdrop-technical-description-2ec43f718924)  
  
Linkdrop Campaign Contract supports 2 ways of distributing tokens:
  - **Transfer Pattern:** requires pre-minted tokens to the campaign creator wallet. Campaign creator needs to approve the Linkdrop Proxy contract deployed for the campaign. The contract transfers tokens from campaign creator wallet directly to receiver.  
  - **Mint Pattern:** requires token contract to support OpenZeppelin [Access Control pattern](https://docs.openzeppelin.com/contracts/4.x/api/access#AccessControl). Campaign creator has to be owner of the token contract and grant minter role (`MINTER_ROLE`) to the Linkdrop proxy contract deployed for the campaign. The contract mints tokens to receiver wallet. 
  
  
## Installation

### Requirements

- OS: Linux/OS X  
- Node: v12  
- Yarn: 1.22  
  
### Install dependencies

```bash
yarn install
```

### Compile contracts

```bash
yarn compile
```

### Test contracts
```bash
yarn test
```

### Deploying contracts

To deploy contracts, copy `.env.sample` to `.env`:
 ```bash
cp .env.sample .env
 ```
Fill in needed env variables (`PRIVATE_KEY`, `JSON_RPC_URL`, etc). Please note that `PRIVATE_KEY` should be without `0x` prefix and `JSON_RPC_URL` should contain the full url including Infura secret key if needed.  


After `.env` variables conigured, run the following command to deploy contracts:

```
yarn deploy
```
