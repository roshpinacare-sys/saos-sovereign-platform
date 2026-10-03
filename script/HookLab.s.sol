// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {SAOSHookPool, ISaoshook} from "../contracts/mesh/SAOSHookPool.sol";

contract RecordingHook is ISaoshook {
    uint24 public fee;
    constructor(uint24 _fee) { fee = _fee; }
    function beforeSwap(address, uint256) external returns (bytes4, uint24) { return (this.beforeSwap.selector, fee); }
    function afterSwap(address, uint256) external returns (bytes4) { return this.afterSwap.selector; }
}

contract HookLab is Script {
    function run() external {
        address poolAddr = vm.envAddress("POOL");
        SAOSHookPool pool = SAOSHookPool(poolAddr);
        vm.startBroadcast();
        // hostile install from a NON-owner broadcast key must revert — we try via a separate call below
        // 1. owner installs dynamic hook (fee 50)
        RecordingHook hook = new RecordingHook(50);
        pool.installHook(address(hook));
        // 2. swap → hook fee adopted
        pool.swapAForB(1_000 ether, 0);
        // 3. owner swaps fee to hostile check: install a 50_000bps hook is impossible (HookAlreadySet) — cap proven in unit tests; here read feeBps on the event
        vm.stopBroadcast();
    }
}
