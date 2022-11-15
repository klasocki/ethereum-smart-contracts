// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "./Car.sol";
import "hardhat/console.sol";

/** 
 * @title CarLease
 * @dev Implements decentralized car leasing system
 */
contract CarLease {

    struct Contract {
        uint monthlyQuota;
        uint32 startTs;
        uint carId;
        uint amountPayed;
        MileageCap mileageCap;
        ContractDuration duration;
        ContractExtensionStatus extended;
        uint24 newKmsForExtension; // used for contract extension
    }

    enum MileageCap { SMALL, MEDIUM, LARGE, UNLIMITED }
    enum ContractDuration { ONE_MONTH, THREE_MONTHS, SIX_MONTHS, TWELVE_MONTHS }
    enum DrivingExperience { NEW_DRIVER, EXPERIENCED_DRIVER }
    enum ContractExtensionStatus { NOT_EXTENDED, PROPOSED, ACCEPTED }

    uint constant SECONDS_IN_MINUTE = 60;
    uint constant MINUTES_IN_HOUR = 60;
    uint constant HOURS_IN_DAY =  24;
    uint constant DAYS_IN_MONTH = 30;

    address payable public owner;
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

    /// @notice Calculate the monthly quota of a car
    /// @param carKms The mileage of the considered car
    /// @param originalValue The original value of the considered car
    /// @param drivingExperience wheter the leasee is an experienced driver or not
    /// @param mileageCap the selected mileage limit
    /// @param duration the duration of the contract
    /// @return Monthly quota in wei
    function calculateMonthlyQuota(uint24 carKms, uint24 originalValue, DrivingExperience drivingExperience, MileageCap mileageCap, ContractDuration duration) public pure returns(uint) {

        uint mileageFactor = 1;

        if (mileageCap == MileageCap.MEDIUM) {
            mileageFactor = 2;
        } else if (mileageCap == MileageCap.LARGE) {
            mileageFactor = 3;
        } else {if (mileageCap == MileageCap.UNLIMITED) 
            mileageFactor = 5;
        }

        uint originalValueFactor = 1;

        if (originalValue > 20_000) {
            originalValueFactor = 2;
        } else if (originalValue > 40_000) {
            originalValueFactor = 3;
        } else if (originalValue > 40_000) {
            originalValueFactor = 5;
        }

        uint durationFactor = 5;

        if (duration == ContractDuration.THREE_MONTHS) {
            durationFactor = 3;
        } else if (duration == ContractDuration.SIX_MONTHS) {
            durationFactor = 2;
        } else if (duration == ContractDuration.TWELVE_MONTHS) {
            durationFactor = 1;
        }

        uint experienceFactor = drivingExperience == DrivingExperience.NEW_DRIVER ? 2 : 1;

        uint quota = (originalValueFactor * durationFactor * mileageFactor * (experienceFactor)) / (1 + ((carKms + 1 ) / 10000));

        return quota*1e6 + 1e7;
    }

    /// @notice Propose a new contract to the leaser, the contract still needs to be confirmed by the leaser. The amount sent must be at least 4x the monthly quota (1 for the rent and 3 for the deposit).
    /// @param carId the car NFT id to rent
    /// @param drivingExperience the years of driving license ownage
    /// @param mileageCap the selected mileage limit
    /// @param duration the duration of the contract
    function proposeContract(uint carId, DrivingExperience drivingExperience, MileageCap mileageCap, ContractDuration duration) external payable {

        CarLibrary.CarData memory carData = carToken.getCarData(carId);

        require(contracts[msg.sender].monthlyQuota == 0, "You already have a contract, delete it before doing a new one."); // easier way to check for previous proposals
        require(carData.leasee == address(0), "The car is already rented.");
        require(carData.yearOfMatriculation != 0, "The car doesn't exists.");

        uint monthlyQuota = calculateMonthlyQuota(carData.kms, carData.originalValue, drivingExperience, mileageCap, duration);

        require(msg.value >= 4 * monthlyQuota, "Amount sent is not enough.");
        require(msg.value <= (3+getDurationInMonths(duration))*monthlyQuota, "Amount sent is too much.");

        contracts[msg.sender] = Contract(monthlyQuota, 0, carId, msg.value - 3*monthlyQuota, mileageCap, duration, ContractExtensionStatus.NOT_EXTENDED, carData.kms);
    }
    
    /// @notice Delete and refund a contract proposal, called by leasee
    function deleteContractProposal() external {

        uint monthlyQuota = contracts[msg.sender].monthlyQuota;

        require(monthlyQuota > 0, "No contracts found.");
        require(contracts[msg.sender].startTs == 0, "Contract already started.");

        payable(msg.sender).transfer(3*monthlyQuota + contracts[msg.sender].amountPayed);
        delete contracts[msg.sender];
    }

    /// @notice Accept or refuse a contract proposal, called by leaser
    function evaluateContract(address leasee, bool accept) external onlyOwner {
        
        Contract storage con = contracts[leasee];

        require(con.monthlyQuota > 0, "Leasee doesn't have contracts to evaluate.");
        require(con.startTs == 0, "Leasee contract has already started.");

        if (accept) {
            require(carToken.getCarData(con.carId).leasee == address(0), "Car is already rented!");
            con.startTs = uint32(block.timestamp);
            carToken.setCarLeasee(con.carId, leasee);
            transferrableAmount += con.amountPayed;
        } else {
            payable(leasee).transfer(3*con.monthlyQuota+con.amountPayed);
            delete contracts[leasee];
        }

    }

    /// @notice Check if the contract related to the given car is unpaid or expired. It also performs consecuent actions such as contract termination, extension and deposit refund.
    /// @param carId the car NFT id to check
    function checkInsolvency(uint carId) external {
        // get the leasee related to the car
        address leasee = carToken.getCarData(carId).leasee;
        require(leasee != address(0), "Car is not rented.");
        // get the contract related to the leasee
        Contract memory con = contracts[leasee];
        require(con.monthlyQuota > 0, "Contract not found.");
        // calculate the number of months elapsed since the contract start, including the current month
        uint monthsPassed = 1 + ( (block.timestamp - con.startTs) / SECONDS_IN_MINUTE / MINUTES_IN_HOUR / HOURS_IN_DAY / DAYS_IN_MONTH ); // TODO: test this calculation
        // get total contract duration
        uint durationMonths = getDurationInMonths(con.duration);

        if (monthsPassed > durationMonths) {
            // contract expired
            if (con.amountPayed >= durationMonths*con.monthlyQuota){
                // contract paid in full, check for extension or terminate it
                if (con.extended == ContractExtensionStatus.ACCEPTED) {
                    // if the contract is expired and renewd, perform the renewal
                    extendContract(leasee);
                } else {
                    // if contract is expired and not renewd, refund the deposit and delete the contract
                    deleteContract(leasee, true); 
                }
            } else {
                // the client hasn't payed some months, take the deposit and delete the contract
                deleteContract(leasee, false); 
            }
        } else if (con.amountPayed < monthsPassed*con.monthlyQuota) {
            deleteContract(leasee, false); // If not enough money paid, cancel the contract and take deposit
        }
    }

    /// @notice Open the car, checking if the sender is authorized
    function openCar(uint carId) external view {
        // checkInsolvency(carId);
        require(carToken.getCarData(carId).leasee == msg.sender, "Car not rented to this user.");
    }

    /// @notice Mint a new car NFT and set the ownership to the leasee.
    function createCar(string memory model, string memory colour, uint16 yearOfMatriculation, uint24 originalValue, uint24 kms) external onlyOwner returns(uint) {
        uint tokenId = carToken.safeMint(msg.sender, model, colour, yearOfMatriculation, originalValue, kms);
        return tokenId;
    }
    
    /// @notice Function that allows users to see how much they have already payed
    function getAmountPayed() external view returns(uint) {
        return contracts[msg.sender].amountPayed;
    }

    /// @notice Function used to pay the rent, it can be payed everytime the leasee wants.
    function payRent() external payable {
        Contract storage con = contracts[msg.sender];
        require(con.monthlyQuota > 0 && con.startTs > 0, "Contract not found.");
        require(con.amountPayed + msg.value <= getDurationInMonths(con.duration)*con.monthlyQuota, "You sent too much money.");
        con.amountPayed += msg.value;
        transferrableAmount += msg.value;
    }

    function retrieveMoney(uint amount) external onlyOwner {
        // required because the SC also has the money of the deposits that shouldn't be transferrable.
        require(amount <= transferrableAmount, "Not enough money in the contract.");
        transferrableAmount -= amount;
        owner.transfer(amount);
    }

    /// @notice Called by the leasee, extende a contract, the driver automatically becomes experienced because they drove the car before.
    /// @param newKmsForExtension the updated mileage of the car, it must be higher than the previous one. The Leaser can still refuse the extension id the new mileage is wrong.
    function proposeContractExtension(uint24 newKmsForExtension) external payable {
        Contract storage con = contracts[msg.sender];
        CarLibrary.CarData memory carData = carToken.getCarData(con.carId);
        require(con.monthlyQuota > 0 && con.startTs > 0, "Contract not found.");        
        
        uint newMonthlyQuota = calculateMonthlyQuota(newKmsForExtension, carData.originalValue, DrivingExperience.EXPERIENCED_DRIVER, con.mileageCap, ContractDuration.TWELVE_MONTHS);
        require(msg.value == newMonthlyQuota, "You need to pay first month's rent when proposing an extension");

        uint durationMonths = getDurationInMonths(con.duration);
        uint endTimestamp = con.startTs + durationMonths*DAYS_IN_MONTH*HOURS_IN_DAY*MINUTES_IN_HOUR*SECONDS_IN_MINUTE;
        uint oneWeekInSeconds = SECONDS_IN_MINUTE*MINUTES_IN_HOUR*HOURS_IN_DAY*7;
        
        require(block.timestamp < endTimestamp, "Contract is expired.");
        require(endTimestamp < block.timestamp + oneWeekInSeconds, "You can only propose an extension one week before the contract ends.");
        require(carData.kms <= newKmsForExtension,"The new kms must be greater or equal than the current kms.");
        
        con.extended = ContractExtensionStatus.PROPOSED;
        con.newKmsForExtension = newKmsForExtension;
        // add the first month's rent to the amount payed, but don't add it to the transferrable amount (it will be added when the extension is performed)
        con.amountPayed += msg.value; 
    }

    /// @notice Called by the leasee, remove the extension proposal.
    function cancelContractExtension() external {
        Contract storage con = contracts[msg.sender];
        require(con.monthlyQuota > 0 && con.startTs > 0, "Contract not found.");
        require(con.extended == ContractExtensionStatus.PROPOSED, "Contract not proposed to be extended.");

        // remove the fact that the user registered the extension
        con.extended = ContractExtensionStatus.NOT_EXTENDED;

        // calculate the new monthly quota to refund
        CarLibrary.CarData memory carData = carToken.getCarData(con.carId);
        uint newMonthlyQuota = calculateMonthlyQuota(con.newKmsForExtension, carData.originalValue, DrivingExperience.EXPERIENCED_DRIVER, con.mileageCap, ContractDuration.TWELVE_MONTHS);

        // remove the first month's rent from the amount payed and refund it
        con.amountPayed -= con.monthlyQuota;
        payable(msg.sender).transfer(newMonthlyQuota);

    }

    /// @notice Called by the leaser, accept the extension proposal. To refuse the extension, just don't call this function and wait for the contract to expire.
    function confirmContractExtension(uint carId) external onlyOwner {        
        address leasee = carToken.getCarData(carId).leasee;
        Contract storage con = contracts[leasee];
        require(con.extended == ContractExtensionStatus.PROPOSED, "Contract not proposed to be extended.");
        con.extended = ContractExtensionStatus.ACCEPTED;
    }
    
    /// @notice Internal function that performs the deletion of a contract. Called with trusted parameters.
    function deleteContract(address leasee, bool refundDeposit) internal {
        Contract memory con = contracts[leasee];

        uint excessPayed = 0;
        
        if (con.amountPayed > (con.monthlyQuota * getDurationInMonths(con.duration))) {
            excessPayed = con.amountPayed - (con.monthlyQuota * getDurationInMonths(con.duration));
        }

        if (refundDeposit) {
            payable(leasee).transfer(3*con.monthlyQuota + excessPayed);
            transferrableAmount -= excessPayed;
        } else {
            transferrableAmount += 3*con.monthlyQuota;
        }
        delete contracts[leasee];
        carToken.setCarLeasee(con.carId, address(0));
    }

    function extendContract(address leasee) internal {

        Contract storage con = contracts[leasee];
        CarLibrary.CarData memory carData = carToken.getCarData(con.carId);
        uint newMonthlyQuota = calculateMonthlyQuota(con.newKmsForExtension, carData.originalValue, DrivingExperience.EXPERIENCED_DRIVER, con.mileageCap, ContractDuration.TWELVE_MONTHS);

        uint newDeposit = 3*newMonthlyQuota;
        uint oldDeposit = 3*con.monthlyQuota;

        // uncchecked because we know that oldDeposit is greater than newDeposit
        unchecked {
        // add the difference between the old and the new deposit to the amount payed (instead of refunding it, it's expensive)
            con.amountPayed += oldDeposit - newDeposit; 
            // add the difference to the transferrable amount
            transferrableAmount += newDeposit - oldDeposit; 
            // add the first month's rent to the transferrable amount, before it was just added to the amount payed
            transferrableAmount += newMonthlyQuota;
        }

        uint lastContractDuration = getDurationInMonths(con.duration);

        con.amountPayed -= con.monthlyQuota*lastContractDuration;
        con.startTs = uint32(block.timestamp);
        con.extended = ContractExtensionStatus.NOT_EXTENDED;
        con.monthlyQuota = newMonthlyQuota;
        con.duration = ContractDuration.TWELVE_MONTHS;

        // update the car's kms
        carToken.setCarKms(con.carId, con.newKmsForExtension);
    }

    function getDurationInMonths(ContractDuration duration) internal pure returns (uint) {
        if (duration == ContractDuration.THREE_MONTHS) {
            return 3;
        } else if (duration == ContractDuration.SIX_MONTHS) {
            return 6;
        } else if (duration == ContractDuration.TWELVE_MONTHS) {
            return 12;
        }
        return 1;
    }
}