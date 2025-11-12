pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WhiteLotto_FHE is ZamaEthereumConfig {
    struct Participant {
        euint32 encryptedAddress;
        uint256 deposit;
        bool isWinner;
    }

    struct Lottery {
        string lotteryId;
        uint256 startTime;
        uint256 endTime;
        uint256 ticketPrice;
        uint256 maxParticipants;
        uint256 winnerCount;
        bool isCompleted;
        bool isCancelled;
    }

    mapping(string => Lottery) public lotteries;
    mapping(string => mapping(address => bool)) public userParticipated;
    mapping(string => Participant[]) public participants;
    mapping(string => address[]) public winners;

    event LotteryCreated(string indexed lotteryId, uint256 ticketPrice, uint256 maxParticipants);
    event Participated(string indexed lotteryId, address indexed participant);
    event LotteryCancelled(string indexed lotteryId);
    event WinnerSelected(string indexed lotteryId, address indexed winner);

    modifier onlyValidLottery(string calldata lotteryId) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        _;
    }

    modifier onlyActiveLottery(string calldata lotteryId) {
        require(block.timestamp >= lotteries[lotteryId].startTime, "Lottery not started");
        require(block.timestamp <= lotteries[lotteryId].endTime, "Lottery ended");
        require(!lotteries[lotteryId].isCancelled, "Lottery cancelled");
        _;
    }

    constructor() ZamaEthereumConfig() {
    }

    function createLottery(
        string calldata lotteryId,
        uint256 startTime,
        uint256 endTime,
        uint256 ticketPrice,
        uint256 maxParticipants,
        uint256 winnerCount
    ) external {
        require(bytes(lotteries[lotteryId].lotteryId).length == 0, "Lottery already exists");
        require(startTime > block.timestamp, "Start time must be in future");
        require(endTime > startTime, "End time must be after start time");
        require(winnerCount <= maxParticipants, "Winner count exceeds max participants");

        lotteries[lotteryId] = Lottery({
            lotteryId: lotteryId,
            startTime: startTime,
            endTime: endTime,
            ticketPrice: ticketPrice,
            maxParticipants: maxParticipants,
            winnerCount: winnerCount,
            isCompleted: false,
            isCancelled: false
        });

        emit LotteryCreated(lotteryId, ticketPrice, maxParticipants);
    }

    function participate(
        string calldata lotteryId,
        externalEuint32 encryptedAddress,
        bytes calldata inputProof
    ) external payable onlyValidLottery(lotteryId) onlyActiveLottery(lotteryId) {
        require(!userParticipated[lotteryId][msg.sender], "Already participated");
        require(participants[lotteryId].length < lotteries[lotteryId].maxParticipants, "Max participants reached");
        require(msg.value == lotteries[lotteryId].ticketPrice, "Incorrect ticket price");

        require(FHE.isInitialized(FHE.fromExternal(encryptedAddress, inputProof)), "Invalid encrypted input");

        participants[lotteryId].push(Participant({
            encryptedAddress: FHE.fromExternal(encryptedAddress, inputProof),
            deposit: msg.value,
            isWinner: false
        }));

        FHE.allowThis(participants[lotteryId][participants[lotteryId].length - 1].encryptedAddress);
        FHE.makePubliclyDecryptable(participants[lotteryId][participants[lotteryId].length - 1].encryptedAddress);

        userParticipated[lotteryId][msg.sender] = true;

        emit Participated(lotteryId, msg.sender);
    }

    function cancelLottery(string calldata lotteryId) external onlyValidLottery(lotteryId) {
        require(msg.sender == lotteries[lotteryId].lotteryId, "Only creator can cancel");
        require(block.timestamp < lotteries[lotteryId].startTime, "Lottery already started");
        require(!lotteries[lotteryId].isCancelled, "Lottery already cancelled");

        lotteries[lotteryId].isCancelled = true;

        for (uint i = 0; i < participants[lotteryId].length; i++) {
            payable(address(uint160(participants[lotteryId][i].encryptedAddress))).transfer(participants[lotteryId][i].deposit);
        }

        emit LotteryCancelled(lotteryId);
    }

    function selectWinners(string calldata lotteryId) external onlyValidLottery(lotteryId) {
        require(block.timestamp > lotteries[lotteryId].endTime, "Lottery not ended");
        require(!lotteries[lotteryId].isCompleted, "Winners already selected");
        require(!lotteries[lotteryId].isCancelled, "Lottery cancelled");

        uint256 winnerCount = lotteries[lotteryId].winnerCount;
        uint256 totalParticipants = participants[lotteryId].length;

        require(winnerCount <= totalParticipants, "Not enough participants");

        for (uint i = 0; i < winnerCount; i++) {
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(block.difficulty, block.timestamp, i))) % totalParticipants;
            Participant storage winner = participants[lotteryId][randomIndex];

            require(!winner.isWinner, "Already selected as winner");

            winner.isWinner = true;
            winners[lotteryId].push(address(uint160(winner.encryptedAddress)));

            payable(address(uint160(winner.encryptedAddress))).transfer(address(this).balance / winnerCount);

            emit WinnerSelected(lotteryId, address(uint160(winner.encryptedAddress)));
        }

        lotteries[lotteryId].isCompleted = true;
    }

    function getLotteryDetails(string calldata lotteryId) external view returns (
        uint256 startTime,
        uint256 endTime,
        uint256 ticketPrice,
        uint256 maxParticipants,
        uint256 winnerCount,
        bool isCompleted,
        bool isCancelled
    ) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");

        return (
            lotteries[lotteryId].startTime,
            lotteries[lotteryId].endTime,
            lotteries[lotteryId].ticketPrice,
            lotteries[lotteryId].maxParticipants,
            lotteries[lotteryId].winnerCount,
            lotteries[lotteryId].isCompleted,
            lotteries[lotteryId].isCancelled
        );
    }

    function getParticipants(string calldata lotteryId) external view returns (address[] memory) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");

        address[] memory participantAddresses = new address[](participants[lotteryId].length);
        for (uint i = 0; i < participants[lotteryId].length; i++) {
            participantAddresses[i] = address(uint160(participants[lotteryId][i].encryptedAddress));
        }
        return participantAddresses;
    }

    function getWinners(string calldata lotteryId) external view returns (address[] memory) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        return winners[lotteryId];
    }

    function isParticipated(string calldata lotteryId, address user) external view returns (bool) {
        return userParticipated[lotteryId][user];
    }
}


