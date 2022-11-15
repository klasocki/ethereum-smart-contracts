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

      await expect(nftContract.getCarData(2)).to.be.revertedWith("Car doesn't exists.");
    });
  });

  describe("Leasing", function () {

    it("Cannot modify a rented car", async function () {
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
      await expect(carLease.retrieveMoney(Number(quota)*3)).to.be.revertedWith("Not enough money in the contract.");

      const afterOneMonth = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(afterOneMonth);
      carLease.checkInsolvency(CAR_ID);

      // Now the company can get the deposit because the client has not paid the second month
      await expect(
        carLease.retrieveMoney(Number(quota)*3)
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
      await carLease.checkInsolvency(0);
      
      // now the contract should be extended
      await carLease.connect(otherAccount).openCar(0);
    });

    it("Multiple extensions", async function () {
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
      await carLease.checkInsolvency(0);
      
      // now the contract should be extended
      await carLease.connect(otherAccount).openCar(0);

      //set time to last week and extend again
      await carLease.connect(otherAccount).payRent({ value: Number(newQuota) });
      const lastWeekOfExtension = (await time.latest()) + ONE_DAY_IN_SECS*25 + ONE_MONTH_IN_SECS * 11;
      await time.increaseTo(lastWeekOfExtension);
      const newNewQuota = await carLease.calculateMonthlyQuota(carData.kms+4_000, carData.originalValue, 1, 0, 3);
      await carLease.connect(otherAccount).proposeContractExtension(carData.kms+4_000, { value: Number(newQuota) });
      await carLease.confirmContractExtension(CAR_ID);

      // set time to after the second extension has started
      const newNewMonth = (await time.latest()) + ONE_DAY_IN_SECS*6;
      await time.increaseTo(newNewMonth);

      //make sure contract works
      await carLease.checkInsolvency(0);
      await carLease.connect(otherAccount).openCar(0);
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
