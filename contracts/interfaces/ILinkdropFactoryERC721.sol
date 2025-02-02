// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.0 <0.8.0;

interface ILinkdropFactoryERC721 {

    function checkClaimParamsERC721
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
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

    function claimERC721
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        uint _expiration,
        address _linkId,
        address payable _linkdropMaster,
        uint _campaignId,
        bytes calldata _linkdropSignerSignature,
        address payable _receiver,
        bytes calldata _receiverSignature
    )
    external
    returns (bool);
}
