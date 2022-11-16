import { HardhatUserConfig } from "hardhat/config";
import 'hardhat-docgen';
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  docgen: {
    path: './docs',
    clear: true,
    runOnCompile: true,
  }
};

export default config;
