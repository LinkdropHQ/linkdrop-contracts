pragma solidity >=0.6.0 <0.8.0;

interface IERC721Mintable {
  function safeMint(address to, uint256 tokenId) external;
}
