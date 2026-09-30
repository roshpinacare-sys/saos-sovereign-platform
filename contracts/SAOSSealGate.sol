// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SAOS Seal Gate — the multi-domain notary of the network (R132, AGENT-Z)
/// @notice The missing EVM primitive of the fleet: ANY external artifact — a
///         Steem post txid, an arsenal article, a KPI snapshot, a forge CI
///         verdict — becomes an immutable, verifiable on-chain proof.
///         Multi-domain by design: `rail` names the source domain
///         (STEEM · ARSENAL · KPI · FORGE · GRID · AUDIT · …), `ref` is the
///         domain-local identifier (txid, permlink, path, run-id).
///         Same constitution as SAOSRelay: no owner, no fees, no upgrade
///         path, no payable — immutable by construction, can never hold funds.
/// @dev    saos-sealgate/v1 · laws ported from the B-2 regression suite:
///         (1) zero-digest rejection, (2) per-rail monotonic heights (anti
///         replay/stale), (3) per-block quota fail-closed (anti-spam — the
///         MINT_CAP discipline applied to notarization), (4) Merkle batch
///         roots for large corpora (the 86-article arsenal seals in one op).
contract SAOSSealGate {
    /// @dev A single external artifact sealed on-chain.
    event Sealed(
        bytes32 indexed digest,
        string rail,
        string ref,
        uint256 height,
        address indexed sealer
    );

    /// @dev A Merkle root over many digests (bulk corpus proof).
    event RootSealed(
        bytes32 indexed root,
        string rail,
        uint256 count,
        uint256 height,
        address indexed sealer
    );

    error ZeroDigest();
    error ZeroRoot();
    error ZeroCount();
    error StaleHeight();      // monotonic per rail — replay/stale rejected
    error QuotaExhausted();   // fail-closed anti-spam (MINT_CAP discipline)
    error RailTooLong();
    error RefTooLong();

    /// @dev Gas-bound identity of a seal.
    struct Seal {
        uint64 at;       // block timestamp
        uint64 blockNo;  // block number
        uint256 height;  // domain-local monotonic height
    }

    /// @dev fail-closed constants (like MINT_CAP: the cap is the law, not a knob)
    uint256 public constant MAX_SEALS_PER_BLOCK = 8;
    uint256 public constant MAX_RAIL_LEN = 16;
    uint256 public constant MAX_REF_LEN = 64;

    /// @dev digest => seal record (single artifacts)
    mapping(bytes32 => Seal) public seals;
    /// @dev rail => last accepted height (monotonic per domain)
    mapping(string => uint256) public lastHeight;
    /// @dev rail => last accepted batch-root height (separate namespace)
    mapping(string => uint256) public lastRootHeight;
    /// @dev block => seals used this block (quota meter)
    mapping(uint256 => uint256) public sealsInBlock;
    /// @dev root => verified batch record
    mapping(bytes32 => Seal) public roots;

    uint256 public totalSeals;
    uint256 public totalRoots;

    /// @notice Seal one external artifact. Height must strictly advance the
    ///         rail's local clock — the domain keeps its own monotonic time.
    function seal(bytes32 digest, string calldata rail, string calldata ref, uint256 height) external {
        if (digest == bytes32(0)) revert ZeroDigest();
        if (bytes(rail).length > MAX_RAIL_LEN) revert RailTooLong();
        if (bytes(ref).length > MAX_REF_LEN) revert RefTooLong();
        if (height <= lastHeight[rail]) revert StaleHeight();
        if (sealsInBlock[block.number] >= MAX_SEALS_PER_BLOCK) revert QuotaExhausted();

        lastHeight[rail] = height;
        sealsInBlock[block.number] += 1;
        seals[digest] = Seal(uint64(block.timestamp), uint64(block.number), height);
        totalSeals += 1;

        emit Sealed(digest, rail, ref, height, msg.sender);
    }

    /// @notice Seal a Merkle root over a corpus (e.g. the whole arsenal).
    ///         count is proven off-chain (leaves+inclusion proofs); the gate
    ///         fixes root+count+height immutably so verification never drifts.
    function sealRoot(bytes32 root, string calldata rail, uint256 count, uint256 height) external {
        if (root == bytes32(0)) revert ZeroRoot();
        if (count == 0) revert ZeroCount();
        if (bytes(rail).length > MAX_RAIL_LEN) revert RailTooLong();
        if (height <= lastRootHeight[rail]) revert StaleHeight();

        lastRootHeight[rail] = height;
        roots[root] = Seal(uint64(block.timestamp), uint64(block.number), height);
        totalRoots += 1;

        emit RootSealed(root, rail, count, height, msg.sender);
    }

    /// @notice Verification API — the whole point: anyone, keyless, forever.
    function isSealed(bytes32 digest) external view returns (bool) {
        return seals[digest].at != 0;
    }

    function isRootSealed(bytes32 root) external view returns (bool) {
        return roots[root].at != 0;
    }

    function sealOf(bytes32 digest)
        external view
        returns (uint64 at, uint64 blockNo, uint256 height)
    {
        Seal storage s = seals[digest];
        return (s.at, s.blockNo, s.height);
    }
}
