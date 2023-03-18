// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.0 <0.8.0;

interface ILinkdropFactory {
  function feeManager() external view returns (address);
}
