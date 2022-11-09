// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
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

contract Car is ERC721, Ownable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;

    mapping(uint => CarLibrary.CarData) carsData;

    constructor() ERC721("Car", "CAR") {}

    modifier onlyApprovedOrOwner(uint256 carId) {
        require(_isApprovedOrOwner(_msgSender(), carId), "Caller is not owner nor approved");
        _;
    }

    modifier notRented(uint256 carId) {
        require(carsData[carId].renter == address(0), "Cannot modify a rented car.");
        _;
    }

    modifier existingCar(uint256 carId) {
        require(_exists(carId), "Car doesn't exists.");
        _;
    }

    function safeMint(address to, string memory model, string memory colour, uint16 yearOfMatriculation, uint24 originalValue, uint24 kms) public onlyOwner returns(uint) {
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(to, tokenId);
        carsData[tokenId] = CarLibrary.CarData(model, colour, yearOfMatriculation, originalValue, kms, address(0));
        return tokenId;
    }
    
    function getCarData(uint carId) public view existingCar(carId) returns(CarLibrary.CarData memory) {
        return carsData[carId];
    }

    function setCarRenter(uint carId, address renter) public existingCar(carId) onlyApprovedOrOwner(carId) notRented(carId) {
        carsData[carId].renter = renter;
    }

    function addCarKm(uint carId, uint24 amount) public existingCar(carId) onlyApprovedOrOwner(carId){
        CarLibrary.CarData storage car = carsData[carId];
        car.kms += amount;
    }
    
    function burn(uint256 carId) public existingCar(carId) onlyApprovedOrOwner(carId) notRented(carId) {
        _burn(carId);
    }

    
}
