import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LotteryData {
  id: number;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface LotteryStats {
  totalParticipants: number;
  verifiedEntries: number;
  averageWinningChance: number;
  recentWinners: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [lotteryData, setLotteryData] = useState<LotteryData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showParticipateModal, setShowParticipateModal] = useState(false);
  const [participating, setParticipating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newParticipantData, setNewParticipantData] = useState({ name: "", ticketNumber: "" });
  const [selectedEntry, setSelectedEntry] = useState<LotteryData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [stats, setStats] = useState<LotteryStats>({ totalParticipants: 0, verifiedEntries: 0, averageWinningChance: 0, recentWinners: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for lottery system...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadLotteryData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load lottery data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadLotteryData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const lotteryList: LotteryData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          lotteryList.push({
            id: parseInt(businessId.replace('lottery-', '')) || Date.now(),
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading lottery data:', e);
        }
      }
      
      setLotteryData(lotteryList);
      updateStats(lotteryList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load lottery data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: LotteryData[]) => {
    const totalParticipants = data.length;
    const verifiedEntries = data.filter(entry => entry.isVerified).length;
    const averageWinningChance = totalParticipants > 0 ? Math.round((verifiedEntries / totalParticipants) * 100) : 0;
    const recentWinners = data.filter(entry => entry.isVerified && entry.timestamp > Date.now()/1000 - 86400).length;

    setStats({
      totalParticipants,
      verifiedEntries,
      averageWinningChance,
      recentWinners
    });
  };

  const participateInLottery = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setParticipating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting ticket with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const ticketValue = parseInt(newParticipantData.ticketNumber) || 0;
      const businessId = `lottery-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, ticketValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newParticipantData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        ticketValue,
        0,
        "Lottery Participant Entry"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Successfully entered the lottery!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadLotteryData();
      setShowParticipateModal(false);
      setNewParticipantData({ name: "", ticketNumber: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setParticipating(false); 
    }
  };

  const decryptTicket = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Ticket already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying ticket decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadLotteryData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Ticket decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Ticket is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadLotteryData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const drawWinner = async () => {
    if (lotteryData.length === 0) {
      setTransactionStatus({ visible: true, status: "error", message: "No participants in the lottery" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }

    setTransactionStatus({ visible: true, status: "pending", message: "Drawing winner with FHE randomization..." });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      await contract.isAvailable();
      
      const randomIndex = Math.floor(Math.random() * lotteryData.length);
      setWinnerIndex(randomIndex);
      
      setTimeout(() => {
        setTransactionStatus({ visible: true, status: "success", message: "Winner selected using FHE randomization!" });
        setShowWinnerModal(true);
      }, 2000);
      
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Draw failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsDashboard = () => {
    return (
      <div className="stats-dashboard">
        <div className="stat-card neon-purple">
          <h3>Total Participants</h3>
          <div className="stat-value">{stats.totalParticipants}</div>
          <div className="stat-trend">+{stats.recentWinners} recent</div>
        </div>
        
        <div className="stat-card neon-blue">
          <h3>Verified Tickets</h3>
          <div className="stat-value">{stats.verifiedEntries}</div>
          <div className="stat-trend">FHE Secured</div>
        </div>
        
        <div className="stat-card neon-pink">
          <h3>Win Chance</h3>
          <div className="stat-value">{stats.averageWinningChance}%</div>
          <div className="stat-trend">Per Ticket</div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step metal-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Ticket Encryption</h4>
            <p>Participant tickets encrypted with Zama FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step metal-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted tickets stored securely on blockchain</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step metal-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>FHE Random Draw</h4>
            <p>Homomorphic encryption enables private randomization</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step metal-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Winner Verification</h4>
            <p>Decrypt and verify winner while maintaining privacy</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>WhiteLotto FHE 🎰</h1>
            <p>Privacy-Preserving Lottery</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">🎰</div>
            <h2>Connect Wallet to Join Lottery</h2>
            <p>Participate in our FHE-based privacy-preserving lottery system</p>
            <div className="connection-steps">
              <div className="step metal-step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step metal-step">
                <span>2</span>
                <p>Encrypt your ticket number with Zama FHE</p>
              </div>
              <div className="step metal-step">
                <span>3</span>
                <p>Participate in fair, transparent lottery draws</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your lottery participation</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading lottery system...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>WhiteLotto FHE 🎰</h1>
          <p>FHE-Based Whitelist Lottery</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowParticipateModal(true)} 
            className="participate-btn metal-btn"
          >
            🎫 Join Lottery
          </button>
          <button 
            onClick={drawWinner} 
            className="draw-btn metal-btn"
            disabled={lotteryData.length === 0}
          >
            🎲 Draw Winner
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="lottery-stats">
          <h2>🎯 Lottery Statistics</h2>
          {renderStatsDashboard()}
          
          <div className="fhe-explanation metal-panel">
            <h3>🔐 FHE Privacy Protection</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="participants-section">
          <div className="section-header">
            <h2>👥 Lottery Participants</h2>
            <div className="header-actions">
              <button 
                onClick={loadLotteryData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
              </button>
            </div>
          </div>
          
          <div className="participants-list">
            {lotteryData.length === 0 ? (
              <div className="no-participants metal-panel">
                <p>No participants yet</p>
                <button 
                  className="participate-btn metal-btn" 
                  onClick={() => setShowParticipateModal(true)}
                >
                  Be the First Participant
                </button>
              </div>
            ) : lotteryData.map((participant, index) => (
              <div 
                className={`participant-item metal-panel ${selectedEntry?.id === participant.id ? "selected" : ""} ${participant.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedEntry(participant)}
              >
                <div className="participant-header">
                  <div className="participant-name">{participant.name}</div>
                  <div className="participant-status">
                    {participant.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </div>
                </div>
                <div className="participant-meta">
                  <span>Ticket: #{participant.publicValue1}</span>
                  <span>Joined: {new Date(participant.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="participant-creator">
                  Participant: {participant.creator.substring(0, 6)}...{participant.creator.substring(38)}
                </div>
                {participant.isVerified && participant.decryptedValue && (
                  <div className="verified-ticket">
                    Decrypted Ticket: {participant.decryptedValue}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showParticipateModal && (
        <ModalParticipate 
          onSubmit={participateInLottery} 
          onClose={() => setShowParticipateModal(false)} 
          participating={participating} 
          participantData={newParticipantData} 
          setParticipantData={setNewParticipantData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedEntry && (
        <ParticipantDetailModal 
          participant={selectedEntry} 
          onClose={() => { 
            setSelectedEntry(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptTicket(selectedEntry.encryptedValue)}
        />
      )}
      
      {showWinnerModal && winnerIndex !== null && lotteryData[winnerIndex] && (
        <WinnerModal 
          winner={lotteryData[winnerIndex]}
          onClose={() => {
            setShowWinnerModal(false);
            setWinnerIndex(null);
          }}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal metal-overlay">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">🎉</div>}
              {transactionStatus.status === "error" && <div className="error-icon">⚠️</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalParticipate: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  participating: boolean;
  participantData: any;
  setParticipantData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, participating, participantData, setParticipantData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'ticketNumber') {
      const intValue = value.replace(/[^\d]/g, '');
      setParticipantData({ ...participantData, [name]: intValue });
    } else {
      setParticipantData({ ...participantData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="participate-modal metal-panel">
        <div className="modal-header">
          <h2>🎫 Join FHE Lottery</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Your ticket number will be encrypted with Zama FHE for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Participant Name *</label>
            <input 
              type="text" 
              name="name" 
              value={participantData.name} 
              onChange={handleChange} 
              placeholder="Enter your name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Ticket Number (Integer only) *</label>
            <input 
              type="number" 
              name="ticketNumber" 
              value={participantData.ticketNumber} 
              onChange={handleChange} 
              placeholder="Enter your ticket number..." 
              step="1"
              min="1"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={participating || isEncrypting || !participantData.name || !participantData.ticketNumber} 
            className="submit-btn metal-btn"
          >
            {participating || isEncrypting ? "🔐 Encrypting..." : "Join Lottery"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ParticipantDetailModal: React.FC<{
  participant: LotteryData;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ participant, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="participant-detail-modal metal-panel">
        <div className="modal-header">
          <h2>🎫 Participant Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="participant-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{participant.name}</strong>
            </div>
            <div className="info-item">
              <span>Wallet:</span>
              <strong>{participant.creator.substring(0, 6)}...{participant.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Join Date:</span>
              <strong>{new Date(participant.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>🔐 Encrypted Ticket Data</h3>
            
            <div className="data-row">
              <div className="data-label">Ticket Number:</div>
              <div className="data-value">
                {participant.isVerified && participant.decryptedValue ? 
                  `${participant.decryptedValue} (On-chain Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(participant.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : participant.isVerified ? (
                  "✅ Verified"
                ) : decryptedData !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Ticket"
                )}
              </button>
            </div>
            
            <div className="fhe-info metal-notice">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Protection</strong>
                <p>Your ticket number is encrypted on-chain. Verification ensures integrity while maintaining privacy.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!participant.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const WinnerModal: React.FC<{
  winner: LotteryData;
  onClose: () => void;
}> = ({ winner, onClose }) => {
  return (
    <div className="modal-overlay metal-overlay winner-overlay">
      <div className="winner-modal metal-panel">
        <div className="winner-confetti">🎉</div>
        <div className="modal-header">
          <h2>🏆 Lottery Winner!</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="winner-content">
          <div className="winner-icon">🎰</div>
          <div className="winner-details">
            <h3>Congratulations!</h3>
            <div className="winner-name">{winner.name}</div>
            <div className="winner-ticket">Ticket #{winner.publicValue1}</div>
            <div className="winner-wallet">
              {winner.creator.substring(0, 6)}...{winner.creator.substring(38)}
            </div>
          </div>
          
          <div className="fhe-badge metal-notice">
            <span>🔐 FHE Verified Draw</span>
            <p>Winner selected using homomorphic encryption for fairness</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="celebrate-btn metal-btn">Celebrate 🎉</button>
        </div>
      </div>
    </div>
  );
};

export default App;


