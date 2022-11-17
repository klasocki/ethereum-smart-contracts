import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CarLease", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployAndMintTwoCars() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const CarLease = await ethers.getContractFactory("CarLease");
    const carLease = await CarLease.deploy();
    
    await carLease.createCar("Audi A1", "Red", 2022, 32_000, 12_000);

    await carLease.createCar("Fiat Panda", "White", 2022, 19_000, 1_000);

    const nftContractAddress = await carLease.carToken();
    const nftContract = await ethers.getContractAt("Car", nftContractAddress);

    return { carLease, owner, otherAccount, nftContract };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { carLease, owner } = await loadFixture(deployAndMintTwoCars);

      expect(await carLease.owner()).to.equal(owner.address);
    });

    it("Should create carId zero and one", async function () {
      const { carLease, nftContract } = await loadFixture(deployAndMintTwoCars);

      const car0 = await nftContract.getCarData(0);
      const car1 = await nftContract.getCarData(1);

      expect(car0.model).to.equal("Audi A1");
      expect(car1.model).to.equal("Fiat Panda");

      await expect(nftContract.getCarData(2)).to.be.revertedWith("Car doesn't exist.");
    });
  });

  describe("Leasing", function () {

    it("Can set car kms when not rented", async function(){
      const { carLease, nftContract } = await loadFixture(deployAndMintTwoCars);

      await carLease.setCarKms(0, 50_000);

      expect(await (await nftContract.getCarData(0)).kms).to.equal(50_000);
    });

    it("Cannot approve a non-existing contract proposal", async function () {
      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);
      
      await expect(carLease.evaluateContract(otherAccount.address, true)).to.be.revertedWith("Leasee doesn't have contracts to evaluate.");
    });

    it("Can burn a not rented car", async function () {
      const { nftContract } = await loadFixture(deployAndMintTwoCars);

      await nftContract.burn(0);
      await expect(nftContract.getCarData(0)).to.be.revertedWith("Car doesn't exist.");
      
    });

    it("Cannot rent a non-existing car", async function () {
      const CAR_ID = 2;
      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);

      await expect(carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 0, { value: 50e7})).to.be.revertedWith("Car doesn't exist.");
      
    });

    it("Cannot burn a rented car", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);

      const halfMonth = (await time.latest()) + ONE_MONTH_IN_SECS/2;
      await time.increaseTo(halfMonth);

      await expect(nftContract.burn(CAR_ID)).to.be.revertedWith("Cannot modify a leased car.");
    });

    it("One month lease flow no extension", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const CAR_ID = 1;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(CAR_ID);

      const halfMonth = (await time.latest()) + ONE_MONTH_IN_SECS/2;
      await time.increaseTo(halfMonth);

      // at the middle of the month the user can open the car
      await carLease.checkInsolvency(CAR_ID);
      await carLease.connect(otherAccount).openCar(CAR_ID); 


      const endMonth = (await time.latest()) + ONE_MONTH_IN_SECS/2;
      await time.increaseTo(endMonth);

      // should still be able to open before the lease is checked for insolvency
      await carLease.connect(otherAccount).openCar(CAR_ID); 

      await expect(
        carLease.checkInsolvency(CAR_ID)
      ).to.changeEtherBalance(otherAccount, Number(quota)*3);

      // now the car should be closed
      await expect(carLease.connect(otherAccount).openCar(CAR_ID)).to.be.revertedWith("Car not rented to this user.");

    });

    it("Pay rent in advance for 12 months", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 3);
      await carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 3, { value: (Number(quota)*3 + Number(quota)*12) });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);
      const halfTime = (await time.latest()) + ONE_MONTH_IN_SECS*6;
      await time.increaseTo(halfTime);

      // at the middle of the contract the user can open the car
      await carLease.checkInsolvency(0);
      await carLease.connect(otherAccount).openCar(0); 

      const endTime = (await time.latest()) + ONE_MONTH_IN_SECS*6;
      await time.increaseTo(endTime);

      // should still be able to open before the lease is checked for insolvency
      await carLease.connect(otherAccount).openCar(0); 
      await carLease.checkInsolvency(0);
      // now the car should be closed
      await expect(carLease.connect(otherAccount).openCar(0)).to.be.revertedWith("Car not rented to this user.");

    });

    it("Pay rent periodically", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const ONE_DAY_IN_SECS = 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 1);
      // propose and pay the first month
      await carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 1, { value: (Number(quota)*3 + Number(quota)*1) });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(CAR_ID);

      // after 28 days pay the second month
      const endOfFirstMonth = (await time.latest()) + ONE_MONTH_IN_SECS - ONE_DAY_IN_SECS*2;
      await time.increaseTo(endOfFirstMonth);
      await carLease.connect(otherAccount).payRent({ value: Number(quota) });
      await carLease.checkInsolvency(CAR_ID);
      await carLease.connect(otherAccount).openCar(CAR_ID); 

      // after one month pay the third month
      const endOfSecondMonth = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(endOfSecondMonth);
      await carLease.connect(otherAccount).payRent({ value: Number(quota) });
      await carLease.checkInsolvency(CAR_ID);
      await carLease.connect(otherAccount).openCar(CAR_ID);
    });

    it("Deposit refunded to user", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);

      const endTime = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(endTime);

      await expect(
        carLease.checkInsolvency(0)
      ).to.changeEtherBalance(otherAccount, Number(quota)*3);

    });

    it("Delete proposal and make a new one", async function () {
      const CAR_ID_0 = 0;
      const CAR_ID_1 = 1;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID_0);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(CAR_ID_0, 0, 0, 0, { value: Number(quota)*4 });

      await expect(
        carLease.connect(otherAccount).deleteContractProposal()
      ).to.changeEtherBalance(otherAccount, Number(quota)*4);

      const carData2 = await nftContract.getCarData(CAR_ID_1);
      const quota2 = await carLease.calculateMonthlyQuota(carData2.kms, carData2.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(CAR_ID_1, 0, 0, 0, { value: Number(quota2)*4 });

    });

    it("Deposit given to company", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract, owner } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 3);
      await carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 3, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(CAR_ID);

      // Company tries to get the deposit, but it is not possible because client has paid so far
      await expect(carLease.retrieveMoney(Number(quota)*3, owner.getAddress())).to.be.revertedWith("Not enough money in the contract.");

      const afterOneMonth = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(afterOneMonth);
      carLease.checkInsolvency(CAR_ID);

      // Now the company can get the deposit because the client has not paid the second month
      await expect(
        carLease.retrieveMoney(Number(quota)*3, owner.getAddress())
      ).to.changeEtherBalance(owner, Number(quota)*3);
      
    });

    it("One month lease flow with extension", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const ONE_DAY_IN_SECS = 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);

      const endMonth = (await time.latest()) + ONE_DAY_IN_SECS*25;
      await time.increaseTo(endMonth);

      // when one week is missing, the user requests an extension
      const newQuota = await carLease.calculateMonthlyQuota(carData.kms+2_000, carData.originalValue, 1, 0, 3);
      await carLease.connect(otherAccount).proposeContractExtension(carData.kms+2_000, { value: Number(newQuota) });
      // the company evaluates the extension and accepts it
      await carLease.confirmContractExtension(CAR_ID);

      const newMonth = (await time.latest()) + ONE_DAY_IN_SECS*6;
      await time.increaseTo(newMonth);

      // the check insolvency should trigger the extension
      await carLease.checkInsolvency(CAR_ID);
      
      // now the contract should be extended
      await carLease.connect(otherAccount).openCar(CAR_ID);

      // pay the remaining 11 months
      const amountPayed = await carLease.connect(otherAccount).getAmountPayed();
      await carLease.connect(otherAccount).payRent({ value: Number(newQuota)*12 - Number(amountPayed) });

      // check insolvency before the end of the contract
      const endOfContract = (await time.latest()) + ONE_MONTH_IN_SECS*11;
      await time.increaseTo(endOfContract);

      await carLease.checkInsolvency(CAR_ID);
      await carLease.connect(otherAccount).openCar(CAR_ID);

      // let the contract end
      const contractEnded = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(contractEnded);
      await carLease.checkInsolvency(CAR_ID);
      await expect(carLease.connect(otherAccount).openCar(CAR_ID)).to.be.revertedWith("Car not rented to this user.");

    });

    it("Multiple extensions", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const ONE_DAY_IN_SECS = 24 * 60 * 60;
      const CAR_ID = 0;
      const EXTENSIONS = 10;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      let carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 3);
      await carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 3, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(CAR_ID);

      // pay the remaining 11 months
      await carLease.connect(otherAccount).payRent({ value: Number(quota)*11 });

      for (let i = 0; i < EXTENSIONS; i++) {

        // go to the last week of the contract
        const lastWeekOfContract = (await time.latest()) + ONE_MONTH_IN_SECS*11 + ONE_DAY_IN_SECS*25;
        await time.increaseTo(lastWeekOfContract);
        
        // here we are at the last week of the contract
        await carLease.checkInsolvency(CAR_ID);
        await carLease.connect(otherAccount).openCar(CAR_ID);

        // the user requests an extension
        carData = await nftContract.getCarData(CAR_ID);
        const newQuota = await carLease.calculateMonthlyQuota(carData.kms+10_000, carData.originalValue, 1, 0, 3);
        await carLease.connect(otherAccount).proposeContractExtension(carData.kms+10_000, { value: Number(newQuota) });
        
        // the company evaluates the extension and accepts it
        await carLease.confirmContractExtension(CAR_ID);
        
        // the check insolvency should trigger the extension
        await carLease.checkInsolvency(CAR_ID);

        const firstDayOfExtension = lastWeekOfContract + ONE_DAY_IN_SECS*5;
        await time.increaseTo(firstDayOfExtension);
  
        // the check insolvency should trigger the extension
        await carLease.checkInsolvency(CAR_ID);
        
        // now the contract should be extended
        await carLease.connect(otherAccount).openCar(CAR_ID);
  
        // pay the remaining 11 months
        const amountPayed = await carLease.connect(otherAccount).getAmountPayed();
        await carLease.connect(otherAccount).payRent({ value: Number(newQuota)*12 - Number(amountPayed) });
      }
  
      // let the contract end
      const contractEnded = (await time.latest()) + ONE_MONTH_IN_SECS*12 + ONE_DAY_IN_SECS;
      await time.increaseTo(contractEnded);
      await carLease.checkInsolvency(CAR_ID);
      await expect(carLease.connect(otherAccount).openCar(CAR_ID)).to.be.revertedWith("Car not rented to this user.");
    });

    it("Extension not approved", async function () {
      const ONE_DAY_IN_SECS = 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract, owner } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(CAR_ID, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(CAR_ID);

      const endMonth = (await time.latest()) + ONE_DAY_IN_SECS*25;
      await time.increaseTo(endMonth);

      // when one week is missing, the user requests an extension
      const newQuota = await carLease.calculateMonthlyQuota(carData.kms+2_000, carData.originalValue, 1, 0, 3);
      await carLease.connect(otherAccount).proposeContractExtension(carData.kms+2_000, { value: Number(newQuota) });

      // in the meantime, the company takes the money from the contract of the first month
      await carLease.retrieveMoney(Number(quota), owner.getAddress());
      // the company must not be able to retrieve the deposit
      await expect(carLease.retrieveMoney(Number(quota)*3, owner.getAddress())).to.be.revertedWith("Not enough money in the contract.");
      // the company must not be able to take the new first month
      await expect(carLease.retrieveMoney(Number(newQuota), owner.getAddress())).to.be.revertedWith("Not enough money in the contract.");
      
      // the contract expires and the extension is not approved
      const newMonth = (await time.latest()) + ONE_DAY_IN_SECS*6;
      await time.increaseTo(newMonth);

      // the check insolvency should trigger the end of the contract and the refund of the deposit + the new first month
      await expect(
        carLease.checkInsolvency(CAR_ID)
      ).to.changeEtherBalance(otherAccount, Number(quota)*3 + Number(newQuota));
    });

    it("Cancelling a contract extension", async function () {
      const ONE_DAY_IN_SECS = 24 * 60 * 60;
      const CAR_ID = 0;

      const { carLease, otherAccount, nftContract } = await loadFixture(deployAndMintTwoCars);

      const carData = await nftContract.getCarData(CAR_ID);
      const quota = await carLease.calculateMonthlyQuota(carData.kms, carData.originalValue, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);

      const endMonth = (await time.latest()) + ONE_DAY_IN_SECS*25;
      await time.increaseTo(endMonth);

      // when one week is missing, the user requests an extension
      const newQuota = await carLease.calculateMonthlyQuota(carData.kms+2_000, carData.originalValue, 1, 0, 3);
      await carLease.connect(otherAccount).proposeContractExtension(carData.kms+2_000, { value: Number(newQuota) });

      // the user cancels the extension himself

      await expect(
        carLease.connect(otherAccount).cancelContractExtension()
      ).to.changeEtherBalance(otherAccount, Number(newQuota));
    });

  });
});
