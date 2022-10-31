// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "./Car.sol";

/** 
 * @title CarLease
 * @dev Implements car leasing
 */
contract CarLease {

    enum MileageCap { SMALL, MEDIUM, LARGE, UNLIMITED }
    enum ContractDuration { ONE_MONTH, THREE_MONTHS, SIX_MONTHS, TWELVE_MONTHS }

    address payable private owner;
    Car public carToken;
    mapping (address => bool) private employees;

    constructor() {
        owner = payable(msg.sender);
        carToken = new Car();
    }

    // Only the owner of the SC can call the function
    modifier onlyOwner() {
        require( msg.sender == owner , "Only owner can call this.");
        _;
    }

    // Only the owner of the SC or the admins cal call the function
    modifier onlyAdmin() {
        require( msg.sender == owner || employees[msg.sender], "Only admins can call this.");
        _;
    }

    // Add the given address to the employees list
    function addEmployee(address _employee) public onlyOwner {
        employees[_employee] = true;
    }

    // Remove the given address to the employees list
    function removeEmployee(address _employee) public onlyOwner {
        delete employees[_employee];
    }

    /// @notice Calculate the monthly quota of a car lease
    /// @dev WORK IN PROGRESS this is just an example, it's still missing the car NFT in the calculation
    /// @param yearsOfExperience the years of possession of a dricing license
    /// @param mileageCap the selected mileage limit
    /// @param duration the duration of the contract
    /// @return Monthly quota in ether (?)
    function calculateMonthlyQuota(CarLibrary.CarData memory car, uint8 yearsOfExperience, MileageCap mileageCap, ContractDuration duration) public pure returns(uint) {
        
        require(yearsOfExperience < 100, "yearsOfExperience must be less than 100.");

        uint mileageFactor = 1;

        if (mileageCap == MileageCap.MEDIUM) {
            mileageFactor = 2;
        } else if (mileageCap == MileageCap.LARGE) {
            mileageFactor = 3;
        } else {if (mileageCap == MileageCap.UNLIMITED) 
            mileageFactor = 5;
        }

        uint durationFactor = 5;

        if (duration == ContractDuration.THREE_MONTHS) {
            durationFactor = 3;
        } else if (duration == ContractDuration.SIX_MONTHS) {
            durationFactor = 2;
        } else if (duration == ContractDuration.TWELVE_MONTHS) {
            durationFactor = 1;
        }

        uint quota = (durationFactor * mileageFactor * (100 - yearsOfExperience)) / (1 + ((car.kms + 1 ) / 10000));

        return quota;
    }

    /// @notice Propose a new contract to the leaser, the contract still needs to be confirmed by the leaser. The amount sent must be 4x the monthly quota (1 for the rent and 3 for the deposit)
    /// @dev WORK IN PROGRESS
    /// @param carId the car NFT id to rent
    /// @param yearsOfExperience the years of driving license ownage
    /// @param mileageCap the selected mileage limit
    /// @param duration the duration of the contract
    /// @return Contract id (?)
    function proposeContract(uint carId, uint8 yearsOfExperience, MileageCap mileageCap, ContractDuration duration) public payable returns(uint) {
        // TODO: implement this
        return 0;
    }

    /// @notice Delete a contract proposal and refund the sent money.
    /// @dev WORK IN PROGRESS
    function deleteContractProposal(uint contractId) public {
        // TODO: implement this
    }

    /// @notice Accept or refuse a contract proposal
    /// @dev WORK IN PROGRESS
    function evaluateContract(uint contractId, bool accept) public onlyAdmin {
        // TODO: implement this
    }

    /// @notice Check if there is any unpaid contract. It also performs consecuent actions.
    /// @dev WORK IN PROGRESS
    function checkInsolvencies() public onlyAdmin {
        // TODO: implement this
        // this should go throught every contract and see if there are unpaid ones. 
        // If so, the locked amount must be sent to leaser (owner) and the contract must be eliminated.
    }



}