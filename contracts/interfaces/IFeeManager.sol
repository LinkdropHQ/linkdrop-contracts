pragma solidity >=0.6.0 <0.8.0;

interface IFeeManager {
  function isWhitelisted(address _addr) external view returns (bool);
  function whitelist(address _addr) external returns (bool);
  function cancelWhitelist(address _addr) external returns (bool);
  function changeFeeReceiver(address payable _addr) external returns (bool);
  function updateFee(uint _fee) external returns (bool);
  function updateClaimerFee(uint _claimerFee) external returns (bool);  
  function withdraw() external returns (bool);
  function calculateFee(
                        address _linkdropMaster,
                        address _tokenAddress,
                        address _receiver) external view returns (uint);
  function feeReceiver() external view returns (address payable);
  function erc20FeePercentage() external view returns (uint);
  function updateErc20FeePercentage(uint _percentage) external returns (bool);
  function calculateErc20Fee(address _linkdropMaster, uint _tokenAmount) external view returns (uint);
}
