pragma solidity >=0.6.0 <0.8.0;

import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../interfaces/IFeeManager.sol";


contract FeeManager is IFeeManager, Ownable  {
  using SafeMath for uint;  
  mapping (address => bool) internal _whitelisted;
  uint public fee; // fee paid by campaign creator if fee is sponsored
  uint public claimerFee;  // fee to paid by receiver if claim is not sponsored
  uint public override erc20FeePercentage;  // in basis points (100 = 1%)
  address payable public override feeReceiver;
  
  constructor() public {
    fee = 0 ether;
    claimerFee = 0 ether;
    erc20FeePercentage = 50; // 0.5%
    feeReceiver = payable(address(this));
  }
  
  function cancelWhitelist(address _addr) public override onlyOwner returns (bool) {
    _whitelisted[_addr] = false;
    return true;
  }

  function whitelist(address _addr) public override onlyOwner returns (bool) {
    _whitelisted[_addr] = true;
    return true;
  }
  
  function isWhitelisted(address _addr) public view override returns (bool) {
    return _whitelisted[_addr];
  }
  
  function changeFeeReceiver(address payable _addr) public override onlyOwner returns (bool) {
    feeReceiver = _addr;
    return true;
  }
  
  function updateFee(uint _fee) public override onlyOwner returns (bool) {
    fee = _fee;
    return true;
  }

  function updateClaimerFee(uint _claimerFee) public override onlyOwner returns (bool) {
    claimerFee = _claimerFee;
    return true;
  }

  function updateErc20FeePercentage(uint _percentage) public override onlyOwner returns (bool) {
    require(_percentage <= 10000, "INVALID_PERCENTAGE");  // max 100%
    erc20FeePercentage = _percentage;
    return true;
  }

  function calculateErc20Fee(
    address _linkdropMaster,
    uint _tokenAmount
  ) public view override returns (uint) {
    if (isWhitelisted(_linkdropMaster)) {
      return 0;
    }
    return _tokenAmount.mul(erc20FeePercentage).div(10000);
  }

  function withdraw() external override onlyOwner returns (bool) {
    msg.sender.transfer(address(this).balance);
    return true;
  }

  function calculateFee(
                        address _linkdropMaster,
                        address /* tokenAddress */,
                        address _receiver) public view override returns (uint) {
    if (isWhitelisted(_linkdropMaster)) {
      return 0;
    }

    if (_receiver == address(tx.origin)) {
      return claimerFee;
    }
        
    return fee;
  }
 
  /**
   * @dev Fallback function to accept ETH
   */
  receive() external payable {}  
}
