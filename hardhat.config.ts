import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import 'hardhat-docgen';
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

const { API_URL, API_KEY, PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  defaultNetwork: "sepolia", 
  networks: {    
    hardhat: {},   
    sepolia: {     
     url: API_URL,      
     accounts: [`0x${PRIVATE_KEY}`],   
    }
  },
  docgen: {
    path: './docs',
    clear: true,
    runOnCompile: true,
  },
  etherscan: {
    apiKey: `${API_KEY}`
  }
};

export default config;
