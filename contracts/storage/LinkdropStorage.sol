// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.0 <0.8.0;
import "../interfaces/ILinkdropFactory.sol";

contract LinkdropStorage {

    // Address of contract deploying proxies
    ILinkdropFactory public factory;

    // Address corresponding to linkdrop master key
    address payable public linkdropMaster;

    // Version of mastercopy contract
    uint public version;

    // Network id
    uint public chainId;

    // Indicates whether an address corresponds to linkdrop signing key
    mapping (address => bool) public isLinkdropSigner;

    // Indicates who the link is claimed to
    mapping (address => address) public claimedTo;

    // Indicates whether the link is canceled or not
    mapping (address => bool) internal _canceled;

    // Indicates whether the initializer function has been called or not
    bool public initialized;

    // Indicates whether the contract is paused or not
    bool internal _paused;

    // Indicates which pattern the campaign will use (mint on claim, transfer pre-minted tokens, etc)  
    uint public claimPattern;
    
    // Events
    event Canceled(address linkId);
    event Claimed(address indexed linkId, uint ethAmount, address indexed token, uint tokenAmount, address receiver);
    event ClaimedERC721(address indexed linkId, uint ethAmount, address indexed nft, uint tokenId, address receiver);
    event ClaimedERC1155(address indexed linkId, uint ethAmount, address indexed nft, uint tokenId, uint tokenAmount, address receiver);    
    event Paused();
    event Unpaused();
    event AddedSigningKey(address linkdropSigner);
    event RemovedSigningKey(address linkdropSigner);

}
