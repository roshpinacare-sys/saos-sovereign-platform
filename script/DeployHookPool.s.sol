// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {SAOSHookPool} from "../contracts/mesh/SAOSHookPool.sol";

contract DeployHookPool is Script {
    function run() external returns (address pool) {
        vm.startBroadcast();
        pool = address(new SAOSHookPool(address(0xA11CE), address(0xB0B), 30));
        SAOSHookPool(pool).fund(1_000_000 ether, 1_000_000 ether);
        vm.stopBroadcast();
    }
}
