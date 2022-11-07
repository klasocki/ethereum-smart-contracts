// SPDX-License-Identifier: GPL-3.0
        
pragma solidity >=0.4.22 <0.9.0;

// This import is automatically injected by Remix
import "remix_tests.sol"; 

// This import is required to use custom transaction context
// Although it may fail compilation in 'Solidity Compiler' plugin
// But it will work fine in 'Solidity Unit Testing' plugin
import "remix_accounts.sol";
import "../CarLease.sol";

// File name has to end with '_test.sol', this file can contain more than one testSuite contracts
contract CarLeaseTest is CarLease{

    address acc0;
    address acc1;
    address acc2;

    /// 'beforeAll' runs before all other tests
    function beforeAll() public {
        acc0 = TestsAccounts.getAccount(0); 
        acc1 = TestsAccounts.getAccount(1);
        acc2 = TestsAccounts.getAccount(2);
    }

    // #sender: account-0
    function testMintCar() public {
        uint carId = createCar("Audi A1", "Red", 2022, 20000, 0);
        bytes memory methodSign = abi.encodeWithSignature("ownerOf(uint256)", carId);
        (bool success, bytes memory data) = address(carToken).call(methodSign);
        Assert.equal(success, true, 'execution should be successful');
        address carOwner = abi.decode(data, (address));
        Assert.equal(acc0, carOwner, "Wrong owner");
    }
}
    