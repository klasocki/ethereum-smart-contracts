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

    return { carLease, owner, otherAccount};
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { carLease, owner } = await loadFixture(deployAndMintTwoCars);

      expect(await carLease.owner()).to.equal(owner.address);
    });

    it("Should create carId zero and one", async function () {
      const { carLease } = await loadFixture(deployAndMintTwoCars);
      const quota0 = await carLease.calculateMonthlyQuota(0, 0, 0, 0, 0, 0);
      const quota1 = await carLease.calculateMonthlyQuota(1, 0, 0, 0, 0, 0);

      expect(Number(quota0) > 0).to.be.true;
      expect(Number(quota1) > 0).to.be.true;

      await expect(carLease.calculateMonthlyQuota(2, 0, 0, 0)).to.be.revertedWith("Car doesn't exists.");
    });
  });

  describe("Leasing", function () {

    it("Cannot modify a rented car", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;

      const { carLease, owner, otherAccount } = await loadFixture(deployAndMintTwoCars);


      const quota = await carLease.calculateMonthlyQuota(0, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);

      const halfMonth = (await time.latest()) + ONE_MONTH_IN_SECS/2;
      await time.increaseTo(halfMonth);

      const carToken = await ethers.getContractAt("Car", (await carLease.carToken()));

      await expect(carToken.burn(0)).to.be.revertedWith("Cannot modify a rented car.");
    });

    it("One month lease flow no extension", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
      const CAR_ID = 1;

      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);
      
      const quota = await carLease.calculateMonthlyQuota(CAR_ID, 0, 0, 0);
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

      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);


      const quota = await carLease.calculateMonthlyQuota(0, 0, 0, 3);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 3, { value: (Number(quota)*3 + Number(quota)*12) });
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

      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);


      const quota = await carLease.calculateMonthlyQuota(0, 0, 0, 1);
      // propose and pay the first month
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 1, { value: (Number(quota)*3 + Number(quota)*1) });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);

      // after 29 days pay the second month
      const endOfFirstMonth = (await time.latest()) + ONE_MONTH_IN_SECS - ONE_DAY_IN_SECS;
      await time.increaseTo(endOfFirstMonth);
      await carLease.connect(otherAccount).payRent({ value: Number(quota) });
      await carLease.checkInsolvency(0);
      await carLease.connect(otherAccount).openCar(0); 

      // after one month pay the third month
      const endOfSecondMonth = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(endOfSecondMonth);
      await carLease.connect(otherAccount).payRent({ value: Number(quota) });
      await carLease.checkInsolvency(0);
      await carLease.connect(otherAccount).openCar(0); 
    });

    it("Deposit refunded to user", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;

      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);

      const quota = await carLease.calculateMonthlyQuota(0, 0, 0, 0);
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

      const { carLease, owner, otherAccount } = await loadFixture(deployAndMintTwoCars);

      const quota = await carLease.calculateMonthlyQuota(0, 0, 0, 3);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 3, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);

      // Company tries to get the deposit, but it is not possible because client has paid so far
      await expect(carLease.retrieveMoney(Number(quota)*3)).to.be.revertedWith("Not enough money in the contract.");

      const afterOneMonth = (await time.latest()) + ONE_MONTH_IN_SECS;
      await time.increaseTo(afterOneMonth);
      carLease.checkInsolvency(0);

      // Now the company can get the deposit because the client has not paid the second month
      await expect(
        carLease.retrieveMoney(Number(quota)*3)
      ).to.changeEtherBalance(owner, Number(quota)*3);
      
    });

    it("One month lease flow with extension", async function () {
      const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;

      const { carLease, otherAccount } = await loadFixture(deployAndMintTwoCars);

      const quota = await carLease.calculateMonthlyQuota(0, 0, 0, 0);
      await carLease.connect(otherAccount).proposeContract(0, 0, 0, 0, { value: Number(quota)*4 });
      await carLease.evaluateContract(otherAccount.address, true);
      await carLease.connect(otherAccount).openCar(0);

      const halfMonth = (await time.latest()) + ONE_MONTH_IN_SECS/2;
      await time.increaseTo(halfMonth);

      // at the middle of the month the user requests an extension
      await carLease.connect(otherAccount).proposeContractExtension(0);
      // the company evaluates the extension and accepts it
      await carLease.confirmContractExtension(0);
      // the user pays the first rent of the extension
      await carLease.connect(otherAccount).payRent({ value: Number(quota) });

      const endMonth = (await time.latest()) + ONE_MONTH_IN_SECS/2;
      await time.increaseTo(endMonth);

      // the check insolvency should trigger the extension
      await carLease.checkInsolvency(0);
      
      // now the contract should be extended
      await carLease.connect(otherAccount).openCar(0);
    });

  });
});
