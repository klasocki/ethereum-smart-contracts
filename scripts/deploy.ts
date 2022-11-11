import { ethers } from "hardhat";

async function main() {

  const CarLease = await ethers.getContractFactory("CarLease");
  const carLease = await CarLease.deploy();

  await carLease.deployed();

  console.log("CarLease deployed to:", carLease.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
