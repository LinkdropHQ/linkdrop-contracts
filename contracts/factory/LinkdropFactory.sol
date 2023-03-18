// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.0 <0.8.0;

import "./LinkdropFactoryERC20.sol";
import "./LinkdropFactoryERC721.sol";
import "./LinkdropFactoryERC1155.sol";
import "../fee-manager/FeeManager.sol";

contract LinkdropFactory is LinkdropFactoryERC20, LinkdropFactoryERC721, LinkdropFactoryERC1155 {

  // Address of contract deploying proxies
  FeeManager public feeManager;
  
  /**
   * @dev Constructor that sets bootstap initcode, factory owner, chainId and master copy
   * @param _masterCopy Linkdrop mastercopy contract address to calculate bytecode from
   * @param _chainId Chain id
   */
  constructor(address payable _masterCopy, uint _chainId) public {
    _initcode = (hex"6352c7420d6000526103ff60206004601c335afa6040516060f3");
    chainId = _chainId;
    setMasterCopy(_masterCopy);        
    feeManager = new FeeManager();
    feeManager.transferOwnership(address(msg.sender));
  }
    
  function isWhitelisted(address _addr) public view returns (bool) {
    return feeManager.isWhitelisted(_addr);
  }    
}
