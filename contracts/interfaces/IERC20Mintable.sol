pragma solidity >=0.6.0 <0.8.0;

interface IERC20Mintable {
  function mint(address to, uint256 amount) external;
}
