// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721.sol";
import "openzeppelin-solidity/contracts/access/AccessControl.sol";
import "../interfaces/IERC721Mintable.sol";

contract ERC721Mock is ERC721, AccessControl, IERC721Mintable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public tokenCount = 0;

    constructor() public ERC721("LinkdropMockERC721", "LMT") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(MINTER_ROLE, msg.sender);
        _setBaseURI("https://gateway.pinata.cloud/ipfs/QmUbZMCzsDsQQFims83EAaS2PKD1BBDVxWizQmMUkWS3kV/");
    }

    /* function safeMint(address to, uint256 tokenId)  public override { */
    /*  require(hasRole(MINTER_ROLE, msg.sender), "Not authorized"); */
    /*  _safeMint(to, tokenId);  */
    /* } */

    
    function safeMint(address to)  public override {
     require(hasRole(MINTER_ROLE, msg.sender), "Not authorized");
     ++tokenCount;     
     _safeMint(to, tokenCount); 
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }    
}
