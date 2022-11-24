# TTM4195 - Assignment 3 group 8

This project is an implementation of a car leasing system as a smart contract on the Ethereum blockchain. The smart contract is written in Solidity. It is part of the course TTM4195 - Blockchain technologies and cryptocurrencies at NTNU.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/en/)
- [Hardhat](https://hardhat.org/getting-started/)

### Compile and deploy

To compile and deploy the smart contract, run the following command:

```bash
npx hardhat compile
npx hardhat run scripts/deploy.ts
```

### Run tests

Inside the `test` folder, there are test files. To run thm, run the following command:

```bash
REPORT_GAS=true npx hardhat test
# or 
npx hardhat test
```
