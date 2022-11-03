// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";


library CarLibrary {
    // TODO: optimize storage usage
    struct CarData {
        string model;
        string colour;
        uint16 yearOfMatriculation;
        uint24 originalValue;
        uint24 kms;
        address renter; // current user or null
    }
}

contract Car is ERC721, ERC721Enumerable, Ownable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;

    mapping(uint => CarLibrary.CarData) carsData;

    constructor() ERC721("Car", "CAR") {}

    function safeMint(address to, string memory model, string memory colour, uint16 yearOfMatriculation, uint24 originalValue, uint24 kms) public onlyOwner returns(uint) {
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(to, tokenId);
        carsData[tokenId] = CarLibrary.CarData(model, colour, yearOfMatriculation, originalValue, kms, address(0));
        return tokenId;
    }

    // The following functions are overrides required by Solidity.

    function _beforeTokenTransfer(address from, address to, uint256 tokenId)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function getCarData(uint carId) public view returns(CarLibrary.CarData memory) {
        return carsData[carId];
    }

    function setCarRenter(uint carId, address renter) public onlyOwner {
        carsData[carId].renter = renter;
    }

    function addCarKm(uint carId, uint24 amount) public {
        require(_isApprovedOrOwner(_msgSender(), carId), "ERC721Burnable: caller is not owner nor approved");
        CarLibrary.CarData storage car = carsData[carId];
        car.kms += amount;
    }
    
    function burn(uint256 tokenId) public {
        //solhint-disable-next-line max-line-length
        require(_isApprovedOrOwner(_msgSender(), tokenId), "ERC721Burnable: caller is not owner nor approved");
        require(carsData[tokenId].renter == address(0), "Cannot burn a rented car.");
        _burn(tokenId);
    }
}
