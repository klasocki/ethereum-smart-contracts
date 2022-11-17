// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";


library CarLibrary {
    struct CarData {
        string model;
        string colour;
        uint16 yearOfMatriculation;
        uint24 originalValue;
        uint24 kms;
        address leasee; // current user or 0 if not rented
    }
}

contract Car is ERC721, Ownable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;

    mapping(uint32 => CarLibrary.CarData) carsData;

    constructor() ERC721("Car", "CAR") {}

    modifier onlyTokenOwner(uint32 carId) {
        require(_isApprovedOrOwner(_msgSender(), carId), "Caller is not owner nor approved");
        _;
    }

    modifier notRented(uint32 carId) {
        require(carsData[carId].leasee == address(0), "Cannot modify a leased car.");
        _;
    }

    modifier existingCar(uint32 carId) {
        require(_exists(uint256(carId)), "Car doesn't exist.");
        _;
    }

    function safeMint(address to, string memory model, string memory colour, uint16 yearOfMatriculation, uint24 originalValue, uint24 kms) public onlyOwner returns(uint32) {
        uint256 tokenId = _tokenIdCounter.current();
        require(_tokenIdCounter.current() < 2^32, "Cannot mint more than 4294967296 cars");
        _tokenIdCounter.increment();
        _safeMint(to, tokenId);
        carsData[uint32(tokenId)] = CarLibrary.CarData(model, colour, yearOfMatriculation, originalValue, kms, address(0));
        return uint32(tokenId);
    }
    
    function getCarData(uint32 carId) public view existingCar(carId) returns(CarLibrary.CarData memory) {
        return carsData[carId];
    }

    function setCarLeasee(uint32 carId, address leasee) public existingCar(carId) onlyOwner {
        CarLibrary.CarData storage car = carsData[carId];
        car.leasee = leasee;
    }

    function setCarKms(uint32 carId, uint24 newKms) public existingCar(carId) onlyOwner {
        CarLibrary.CarData storage car = carsData[carId];
        car.kms = newKms;
    }
    
    function burn(uint32 carId) public existingCar(carId) onlyTokenOwner(carId) notRented(carId) {
        _burn(uint256(carId));
    }

    
}
