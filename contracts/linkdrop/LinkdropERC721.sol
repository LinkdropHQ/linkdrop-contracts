// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.0 <0.8.0;

import "./LinkdropCommon.sol";
import "../../interfaces/ILinkdropERC721.sol";
import "../interfaces/IERC721Mintable.sol";
import "../interfaces/IFeeManager.sol";
import "openzeppelin-solidity/contracts/token/ERC721/IERC721.sol";


contract LinkdropERC721 is ILinkdropERC721, LinkdropCommon {
    using SafeMath for uint;
    /**
    * @dev Function to verify linkdrop signer's signature
    * @param _weiAmount Amount of wei to be claimed
    * @param _nftAddress NFT address
    * @param _tokenId Token id to be claimed
    * @param _expiration Unix timestamp of link expiration time
    * @param _linkId Address corresponding to link key
    * @param _signature ECDSA signature of linkdrop signer
    * @return True if signed with linkdrop signer's private key
    */
    function verifyLinkdropSignerSignatureERC721
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        uint _expiration,
        address _linkId,
        bytes memory _signature
    )
    public view
    override       
    returns (bool)
    {
        bytes32 prefixedHash = ECDSA.toEthSignedMessageHash
        (
            keccak256
            (
                abi.encodePacked
                (
                    _weiAmount,
                    _nftAddress,
                    _tokenId,
                    _expiration,
                    version,
                    chainId,
                    _linkId,
                    address(this)
                )
            )
        );
        address signer = ECDSA.recover(prefixedHash, _signature);
        return isLinkdropSigner[signer];
    }

    /**
    * @dev Function to verify linkdrop receiver's signature
    * @param _linkId Address corresponding to link key
    * @param _receiver Address of linkdrop receiver
    * @param _signature ECDSA signature of linkdrop receiver
    * @return True if signed with link key
    */
    function verifyReceiverSignatureERC721
    (
        address _linkId,
        address _receiver,
        bytes memory _signature
    )
    public view
    override       
    returns (bool)
    {
        bytes32 prefixedHash = ECDSA.toEthSignedMessageHash(keccak256(abi.encodePacked(_receiver)));
        address signer = ECDSA.recover(prefixedHash, _signature);
        return signer == _linkId;
    }

    /**
    * @dev Function to verify claim params and make sure the link is not claimed or canceled
    * @param _weiAmount Amount of wei to be claimed
    * @param _nftAddress NFT address
    * @param _tokenId Token id to be claimed
    * @param _expiration Unix timestamp of link expiration time
    * @param _linkId Address corresponding to link key
    * @param _linkdropSignerSignature ECDSA signature of linkdrop signer
    * @param _receiver Address of linkdrop receiver
    * @param _receiverSignature ECDSA signature of linkdrop receiver
    * @return True if success
    */
    function checkClaimParamsERC721
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        uint _expiration,
        address _linkId,
        bytes memory _linkdropSignerSignature,
        address _receiver,
        bytes memory _receiverSignature
    )
    public view
    override       
    whenNotPaused
    returns (bool)
    {
        // Make sure nft address is not equal to address(0)
        require(_nftAddress != address(0), "INVALID_NFT_ADDRESS");

        // Make sure link is not claimed
        require(isClaimedLink(_linkId) == false, "LINK_CLAIMED");

        // Make sure link is not canceled
        require(isCanceledLink(_linkId) == false, "LINK_CANCELED");

        // Make sure link is not expired
        require(_expiration >= now, "LINK_EXPIRED");

        // Make sure eth amount is available for this contract
        require(address(this).balance >= _weiAmount, "INSUFFICIENT_ETHERS");

        // Verify that link key is legit and signed by linkdrop signer's private key
        require
        (
            verifyLinkdropSignerSignatureERC721
            (
                _weiAmount,
                _nftAddress,
                _tokenId,
                _expiration,
                _linkId,
                _linkdropSignerSignature
            ),
            "INVALID_LINKDROP_SIGNER_SIGNATURE"
        );

        // Verify that receiver address is signed by ephemeral key assigned to claim link (link key)
        require
        (
            verifyReceiverSignatureERC721(_linkId, _receiver, _receiverSignature),
            "INVALID_RECEIVER_SIGNATURE"
        );

        return true;
    }

    /**
    * @dev Function to claim ETH and/or ERC721 token. Can only be called when contract is not paused
    * @param _weiAmount Amount of wei to be claimed
    * @param _nftAddress NFT address
    * @param _tokenId Token id to be claimed
    * @param _expiration Unix timestamp of link expiration time
    * @param _linkId Address corresponding to link key
    * @param _linkdropSignerSignature ECDSA signature of linkdrop signer
    * @param _receiver Address of linkdrop receiver
    * @param _receiverSignature ECDSA signature of linkdrop receiver
    * @return True if success
    */
    function claimERC721
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        uint _expiration,
        address _linkId,
        bytes calldata _linkdropSignerSignature,
        address payable _receiver,
        bytes calldata _receiverSignature
    )
    external
    override 
    whenNotPaused
    payable
    returns (bool)
    {

        // Make sure params are valid
        require
        (
            checkClaimParamsERC721
            (
                _weiAmount,
                _nftAddress,
                _tokenId,
                _expiration,
                _linkId,
                _linkdropSignerSignature,
                _receiver,
                _receiverSignature
            ),
            "INVALID_CLAIM_PARAMS"
        );

        // Mark link as claimed
        claimedTo[_linkId] = _receiver;

        // Make sure transfer succeeds
        require(_transferFundsERC721(_weiAmount, _nftAddress, _tokenId, _receiver), "TRANSFER_FAILED");

        // Log claim
        emit ClaimedERC721(_linkId, _weiAmount, _nftAddress, _tokenId, _receiver);

        return true;
    }

    /**
    * @dev Internal function to mint or transfer ERC721 tokens depending on the transfer pattern chosen for the contract.
    * @param _nftAddress NFT address
    * @param _tokenId Amount of tokens to be claimed (in atomic value)
    * @param _receiver Address to transfer funds to
    */
    function _mintOrTransferNFT(
                                   address _nftAddress,
                                   uint _tokenId,
                                   address payable _receiver
                                   ) internal {
      if (claimPattern == 0) { // transfer`
        IERC721(_nftAddress).safeTransferFrom(linkdropMaster, _receiver, _tokenId);
        return;
      } else if (claimPattern == 1) {
        IERC721Mintable(_nftAddress).safeMint(_receiver);
        return;
      }
      revert("UNKNOWN_TRANSFER_PATTERN");
    }


    /**
    * @dev Internal function to transfer ethers and/or ERC721 tokens
    * @param _weiAmount Amount of wei to be claimed
    * @param _nftAddress NFT address
    * @param _tokenId Amount of tokens to be claimed (in atomic value)
    * @param _receiver Address to transfer funds to
    * @return True if success
    */
    function _transferFundsERC721
    (
        uint _weiAmount,
        address _nftAddress,
        uint _tokenId,
        address payable _receiver
    )
    internal returns (bool) {

      // pay Linkdrop fee if needed
      _payFee( _nftAddress, _receiver);
      
      // Transfer ethers
      if (_weiAmount > 0) {
        _receiver.transfer(_weiAmount);
      }

      // Mint or Transfer NFT      
      _mintOrTransferNFT( _nftAddress,
                             _tokenId,
                             _receiver);
      
      return true;
    }
}
