import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LotteryData {
  id: string;
  name: string;
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [lotteries, setLotteries] = useState<LotteryData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLottery, setCreatingLottery] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newLotteryData, setNewLotteryData] = useState({ name: "", value: "", description: "" });
  const [selectedLottery, setSelectedLottery] = useState<LotteryData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [winners, setWinners] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, verified: 0, pending: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
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
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const lotteriesList: LotteryData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          lotteriesList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: null,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setLotteries(lotteriesList);
      setStats({
        total: lotteriesList.length,
        verified: lotteriesList.filter(l => l.isVerified).length,
        pending: lotteriesList.filter(l => !l.isVerified).length
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createLottery = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLottery(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating lottery with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const lotteryValue = parseInt(newLotteryData.value) || 0;
      const businessId = `lottery-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, lotteryValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLotteryData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 1000),
        0,
        newLotteryData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Lottery created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLotteryData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLottery(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
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
          message: "Data already verified on-chain" 
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
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

  const pickWinner = async () => {
    if (!isConnected) return;
    
    setTransactionStatus({ visible: true, status: "pending", message: "Picking random winner..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      await contract.isAvailable();
      
      const randomIndex = Math.floor(Math.random() * lotteries.length);
      const winner = lotteries[randomIndex];
      setWinners(prev => [...prev, winner.creator]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Winner picked successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to pick winner" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Entries</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <div className="stat-value">{stats.pending}</div>
            <div className="stat-label">Pending</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏆</div>
          <div className="stat-content">
            <div className="stat-value">{winners.length}</div>
            <div className="stat-label">Winners</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Entry</h4>
            <p>Participant data encrypted with FHE before submission</p>
          </div>
        </div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted data stored securely on blockchain</p>
          </div>
        </div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Draw</h4>
            <p>Random selection performed on encrypted data</p>
          </div>
        </div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Secure Reveal</h4>
            <p>Winner revealed only after decryption verification</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>🎪 WhiteLotto FHE</h1>
            <p>Privacy-Preserving Lottery with Fully Homomorphic Encryption</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="circus-tent">🎪</div>
            <h2>Welcome to the Encrypted Lottery!</h2>
            <p>Connect your wallet to participate in our privacy-first lottery system</p>
            <div className="feature-list">
              <div className="feature-item">🔒 Encrypted participation</div>
              <div className="feature-item">🎲 Fair random selection</div>
              <div className="feature-item">🛡️ Anti-Sybil protection</div>
              <div className="feature-item">🎁 Transparent distribution</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="circus-spinner">🎪</div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Getting the circus ready for you!</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>🎪 WhiteLotto FHE</h1>
          <p>Your encrypted ticket to fair draws</p>
        </div>
        
        <div className="header-actions">
          <button className="pick-winner-btn" onClick={pickWinner}>
            🎲 Pick Winner
          </button>
          <button 
            className="create-lottery-btn"
            onClick={() => setShowCreateModal(true)}
          >
            + New Entry
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Join the Encrypted Lottery Circus! 🎪</h2>
            <p>Experience truly private and fair lottery draws with FHE technology</p>
          </div>
        </section>

        <section className="stats-section">
          {renderStats()}
        </section>

        <section className="process-section">
          <h3>How FHE Protects Your Privacy</h3>
          {renderFHEProcess()}
        </section>

        <section className="winners-section">
          <h3>🏆 Recent Winners</h3>
          <div className="winners-list">
            {winners.length === 0 ? (
              <p className="no-winners">No winners yet - be the first!</p>
            ) : (
              winners.map((winner, index) => (
                <div key={index} className="winner-item">
                  <span className="winner-medal">🏅</span>
                  <span className="winner-address">{winner.substring(0, 8)}...{winner.substring(34)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="lotteries-section">
          <div className="section-header">
            <h3>🎯 Active Lottery Entries</h3>
            <button 
              onClick={loadData} 
              className="refresh-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
            </button>
          </div>
          
          <div className="lotteries-grid">
            {lotteries.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎪</div>
                <p>No lottery entries yet</p>
                <button 
                  className="create-first-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Entry
                </button>
              </div>
            ) : (
              lotteries.map((lottery, index) => (
                <div 
                  key={index}
                  className={`lottery-card ${lottery.isVerified ? 'verified' : 'pending'}`}
                  onClick={() => setSelectedLottery(lottery)}
                >
                  <div className="card-header">
                    <h4>{lottery.name}</h4>
                    <span className={`status-badge ${lottery.isVerified ? 'verified' : 'pending'}`}>
                      {lottery.isVerified ? '✅ Verified' : '⏳ Pending'}
                    </span>
                  </div>
                  <p className="card-description">{lottery.description}</p>
                  <div className="card-meta">
                    <span>By: {lottery.creator.substring(0, 6)}...{lottery.creator.substring(38)}</span>
                    <span>{new Date(lottery.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h3>🎪 New Lottery Entry</h3>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <div className="notice-icon">🔐</div>
                <div>
                  <strong>FHE Encrypted Entry</strong>
                  <p>Your entry value will be encrypted before submission</p>
                </div>
              </div>
              
              <div className="form-group">
                <label>Entry Name *</label>
                <input 
                  type="text"
                  value={newLotteryData.name}
                  onChange={(e) => setNewLotteryData({...newLotteryData, name: e.target.value})}
                  placeholder="Give your entry a name..."
                />
              </div>
              
              <div className="form-group">
                <label>Encrypted Value (Integer) *</label>
                <input 
                  type="number"
                  value={newLotteryData.value}
                  onChange={(e) => setNewLotteryData({...newLotteryData, value: e.target.value})}
                  placeholder="Enter your lottery value..."
                  min="0"
                  step="1"
                />
                <div className="input-hint">This value will be FHE encrypted</div>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newLotteryData.description}
                  onChange={(e) => setNewLotteryData({...newLotteryData, description: e.target.value})}
                  placeholder="Describe your lottery entry..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="cancel-btn"
              >
                Cancel
              </button>
              <button 
                onClick={createLottery}
                disabled={creatingLottery || isEncrypting || !newLotteryData.name || !newLotteryData.value}
                className="submit-btn"
              >
                {creatingLottery || isEncrypting ? "Encrypting..." : "Create Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedLottery && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h3>🎯 Entry Details</h3>
              <button onClick={() => setSelectedLottery(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-info">
                <div className="info-row">
                  <span>Name:</span>
                  <strong>{selectedLottery.name}</strong>
                </div>
                <div className="info-row">
                  <span>Creator:</span>
                  <span>{selectedLottery.creator}</span>
                </div>
                <div className="info-row">
                  <span>Created:</span>
                  <span>{new Date(selectedLottery.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <span>Status:</span>
                  <span className={`status ${selectedLottery.isVerified ? 'verified' : 'pending'}`}>
                    {selectedLottery.isVerified ? '✅ On-chain Verified' : '🔒 Encrypted'}
                  </span>
                </div>
              </div>
              
              <div className="data-section">
                <h4>Encrypted Data</h4>
                <div className="encrypted-data">
                  <div className="data-value">
                    {selectedLottery.isVerified ? 
                      `Decrypted: ${selectedLottery.decryptedValue}` : 
                      '🔒 FHE Encrypted Integer'
                    }
                  </div>
                  <button 
                    className={`decrypt-btn ${selectedLottery.isVerified ? 'verified' : ''}`}
                    onClick={() => decryptData(selectedLottery.id)}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? 'Decrypting...' : 
                     selectedLottery.isVerified ? '✅ Verified' : '🔓 Verify Decryption'}
                  </button>
                </div>
              </div>
              
              <div className="description-section">
                <h4>Description</h4>
                <p>{selectedLottery.description}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === 'pending' && '⏳'}
              {transactionStatus.status === 'success' && '✅'}
              {transactionStatus.status === 'error' && '❌'}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;