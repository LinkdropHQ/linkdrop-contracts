// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.0 <0.8.0;

interface ILinkdropFactoryERC1155 {

    function checkClaimParamsERC1155
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        uint _tokenAmount,
        uint _expiration,
        address _linkId,
        address payable _linkdropMaster,
        uint _campaignId,
        bytes calldata _linkdropSignerSignature,
        address _receiver,
        bytes calldata _receiverSignature
    )
    external view
    returns (bool);

    function claimERC1155
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        uint _tokenAmount,
        uint _expiration,
        address _linkId,
        address payable _linkdropMaster,
        uint _campaignId,
        bytes calldata _linkdropSignerSignature,
        address payable _receiver,
        bytes calldata _receiverSignature
    )
    external
    payable
    returns (bool);
}
