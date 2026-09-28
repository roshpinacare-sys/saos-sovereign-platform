// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRelayPass} from "../contracts/mesh/MeshTypes.sol";

/// @dev Minimal relay stub for mesh-link unit tests: records every pass() hop
///      so tests can assert the chain actually continued (no dead bytecode).
contract MockRelay is IRelayPass {
    uint256[] public passedRuns;
    uint256 public passCount;

    function pass(uint256 runId, bytes calldata) external {
        passedRuns.push(runId);
        passCount += 1;
    }

    function lastRun() external view returns (uint256) {
        require(passedRuns.length > 0, "no pass yet");
        return passedRuns[passedRuns.length - 1];
    }
}
