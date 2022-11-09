// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "./Car.sol";

/** 
 * @title CarLease
 * @dev Implements car leasing
 */
contract CarLease {

    struct Contract {
        uint monthlyQuota;
        uint startTs;
        uint carId;
        uint amountPayed;
        ContractDuration duration;
        ContractExtensionStatus extended;
        MileageCap newMileageCap; // used for contract extension
    }

    enum MileageCap { SMALL, MEDIUM, LARGE, UNLIMITED }
    enum ContractDuration { ONE_MONTH, THREE_MONTHS, SIX_MONTHS, TWELVE_MONTHS }
    enum YearsOfExperience { NEW_DRIVER, EXPERIENCED_DRIVER }
    enum ContractExtensionStatus { NOT_EXTENDED, PROPOSED, ACCEPTED }

    uint constant SECONDS_IN_MINUTE = 60;
    uint constant MINUTES_IN_HOUR = 60;
    uint constant HOURS_IN_DAY =  24;
    uint constant DAYS_IN_MONTH = 30;

    address payable private owner;
    uint256 transferrableAmount;
    Car public carToken;
    mapping(address => Contract) contracts;

    constructor() {
        owner = payable(msg.sender);
        carToken = new Car();
    }

    // Only the owner of the SC can call the function
    modifier onlyOwner() {
        require( msg.sender == owner , "Only owner can call this.");
        _;
    }

    /// @notice Calculate the monthly quota of a car lease
    /// @dev this is just an example, it's still missing the car NFT in the calculation
    /// @param yearsOfExperience the years of possession of a dricing license
    /// @param mileageCap the selected mileage limit
    /// @param duration the duration of the contract
    /// @return Monthly quota in ether (?)
    function calculateMonthlyQuota(uint carId, YearsOfExperience yearsOfExperience, MileageCap mileageCap, ContractDuration duration) public view returns(uint) {

        CarLibrary.CarData memory car = carToken.getCarData(carId);

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

        uint experienceFactor = yearsOfExperience == YearsOfExperience.NEW_DRIVER ? 2 : 1;

        uint quota = (durationFactor * mileageFactor * (experienceFactor)) / (1 + ((car.kms + 1 ) / 10000));

        return quota*1e6;
    }

    /// @notice Propose a new contract to the leaser, the contract still needs to be confirmed by the leaser. The amount sent must be at least 4x the monthly quota (1 for the rent and 3 for the deposit).
    /// @param carId the car NFT id to rent
    /// @param yearsOfExperience the years of driving license ownage
    /// @param mileageCap the selected mileage limit
    /// @param duration the duration of the contract
    function proposeContract(uint carId, YearsOfExperience yearsOfExperience, MileageCap mileageCap, ContractDuration duration) public payable {

        CarLibrary.CarData memory carData = carToken.getCarData(carId);

        require(contracts[msg.sender].monthlyQuota == 0, "You already have a contract, delete it before doing a new one."); // easier way to check for previous proposals
        require(carData.renter == address(0), "The car is already rented.");
        require(carData.yearOfMatriculation != 0, "The car doesn't exists.");

        uint monthlyQuota = calculateMonthlyQuota(carId, yearsOfExperience, mileageCap, duration);

        require(msg.value >= 4 * monthlyQuota, "Amount sent is not enough."); // TODO: manage unit of measure

        contracts[msg.sender] = Contract(monthlyQuota, 0, carId, msg.value - 3*monthlyQuota, duration, ContractExtensionStatus.NOT_EXTENDED, mileageCap);
    }
    
    /// @notice Delete and refund a contract proposal, called by renter
    function deleteContractProposal() public {

        uint monthlyQuota = contracts[msg.sender].monthlyQuota;

        require(monthlyQuota > 0, "No contracts found.");
        require(contracts[msg.sender].startTs == 0, "Contract already started.");

        payable(msg.sender).transfer(3*monthlyQuota + contracts[msg.sender].amountPayed);
        delete contracts[msg.sender];
    }

    /// @notice Accept or refuse a contract proposal, called by leasee
    function evaluateContract(address contractRenter, bool accept) public onlyOwner {
        
        Contract storage con = contracts[contractRenter];

        require(con.startTs == 0, "Renter doesn't have contracts to evaluate.");

        if (accept) {
            require(carToken.getCarData(con.carId).renter == address(0), "Car is already rented!");
            con.startTs = block.timestamp;
            con.amountPayed = con.monthlyQuota;
            carToken.setCarRenter(con.carId, contractRenter);
            transferrableAmount += con.monthlyQuota;
        } else {
            payable(contractRenter).transfer(3*con.monthlyQuota+con.amountPayed);
            delete contracts[contractRenter];
        }

    }

    /// @notice Check if the contract related to the given car is unpaid or expired. It also performs consecuent actions.
    /// @dev This function does way too much. It should just check the payments, and not cancel or extend probably. 
    function checkInsolvency(uint carId) public {
        // this should check if the contract is unpayed. 
        // If so, the locked amount must be sent to leasee (owner) and the contract must be eliminated.
        // A contract is unpaid if amountPayed < monthsPassed*monthlyQuota

        address renterToCheck = carToken.getCarData(carId).renter;

        Contract memory con = contracts[renterToCheck];
        require(con.monthlyQuota > 0, "Contract not found.");
        uint monthsPassed = (block.timestamp - con.startTs) / SECONDS_IN_MINUTE; // / MINUTES_IN_HOUR; HOURS_IN_DAY / DAYS_IN_MONTH; // TODO: test this calculation

        uint durationMonths = 1;

        if (con.duration == ContractDuration.THREE_MONTHS) {
            durationMonths = 3;
        } else if (con.duration == ContractDuration.SIX_MONTHS) {
            durationMonths = 6;
        } else if (con.duration == ContractDuration.TWELVE_MONTHS) {
            durationMonths = 12;
        }

        if (con.amountPayed < monthsPassed*con.monthlyQuota) {
            deleteContract(renterToCheck, false); // If not enough money paid, cancel the contract and take deposit
        } else if (monthsPassed >= durationMonths) {
            if (con.extended == ContractExtensionStatus.ACCEPTED) {
                extendContract(renterToCheck);  // If contract is expired and renewd, refund the difference of the deposit and renew the contract
            } else {
                deleteContract(renterToCheck, true); // If contract is expired and not renewd, refund the deposit and delete the contract
            }
        } 
    }

    /// @notice Open the car, checking if the sender is authorized
    function openCar(uint carId) public view {
        // checkInsolvency(carId);
        require(contracts[msg.sender].carId==carId, "Car not rented to this user.");
    }

    /// @notice Mint a new car NFT and set the ownership to the leasee.
    function createCar(string memory model, string memory colour, uint16 yearOfMatriculation, uint24 originalValue, uint24 kms) public onlyOwner returns(uint) {
        uint tokenId = carToken.safeMint(msg.sender, model, colour, yearOfMatriculation, originalValue, kms);
        return tokenId;
    }

    /// @notice Function used to pay the rent, it can be payed everytime the renter wants.
    function payRent() public payable {
        require(contracts[msg.sender].monthlyQuota > 0, "Contract not found.");
        contracts[msg.sender].amountPayed += msg.value;
        transferrableAmount += msg.value;
    }

    function retrieveMoney(uint amount) public onlyOwner {
        require(amount <= transferrableAmount, "Not enough money in the contract.");
        owner.transfer(amount);
    }

    /// @notice Called by the renter, extende a contract, the driver automatically becomes experienced because they drove our car before.
    /// @dev Right now the extension is not approved by the leasee
    function proposeContractExtension(MileageCap newMileageCap) public {
        // checkInsolvency(msg.sender);
        require(contracts[msg.sender].monthlyQuota > 0 && contracts[msg.sender].startTs > 0, "Contract not found.");
        Contract storage con = contracts[msg.sender];
        con.extended = ContractExtensionStatus.PROPOSED;
        con.newMileageCap = newMileageCap;
        // Commented because it's done when the contract is extended
        //con.newMonthlyQuota = calculateMonthlyQuota(con.carId, YearsOfExperience.EXPERIENCED_DRIVER, newMileageCap, con.duration);
    }

    /// @notice 
    function confirmContractExtension(address renter) public onlyOwner {
        require(contracts[msg.sender].monthlyQuota > 0 && contracts[msg.sender].startTs > 0, "Contract not found.");
        Contract storage con = contracts[renter];
        con.extended = ContractExtensionStatus.ACCEPTED;
    }
    
    function deleteContract(address renter, bool refundDeposit) internal {
        Contract memory con = contracts[renter];
        if (refundDeposit) {
            payable(renter).transfer(3*con.monthlyQuota);
        } else {
            transferrableAmount += 3*con.monthlyQuota;
        }
        delete contracts[renter];
        carToken.setCarRenter(con.carId, address(0));
    }

    function extendContract(address renter) internal {
        Contract storage con = contracts[renter];

        uint newMonthlyQuota = calculateMonthlyQuota(con.carId, YearsOfExperience.EXPERIENCED_DRIVER, con.newMileageCap, ContractDuration.TWELVE_MONTHS);

        uint newDeposit = 3*newMonthlyQuota;
        uint oldDeposit = 3*con.monthlyQuota;
        payable(renter).transfer(oldDeposit-newDeposit); // send the deposit difference

        uint lastContractDuration = 1;
        if (con.duration == ContractDuration.THREE_MONTHS) {
            lastContractDuration = 3;
        } else if (con.duration == ContractDuration.SIX_MONTHS) {
            lastContractDuration = 6;
        } else if (con.duration == ContractDuration.TWELVE_MONTHS) {
            lastContractDuration = 12;
        }

        con.amountPayed -= con.monthlyQuota*lastContractDuration;

        con.startTs = block.timestamp;
        con.extended = ContractExtensionStatus.NOT_EXTENDED;
        con.monthlyQuota = newMonthlyQuota;
        con.duration = ContractDuration.TWELVE_MONTHS;
    }
}