import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AppContext = createContext();

function unwrapIpcResponse(response) {
  if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok')) {
    if (!response.ok) {
      throw new Error(response.error || 'Unexpected error');
    }

    return response.data;
  }

  return response;
}

export function AppProvider({ children }) {
  const [data, setData] = useState({
    products: [],
    customers: [],
    suppliers: [],
    supplierPayments: [],
    invoices: [],
    purchases: [],
    gstNotes: [],
    gstFilingHistory: [],
    gstLockedPeriods: [],
    uiSettings: null,
    business: null,
    licenseStatus: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchBootstrap = useCallback(async () => {
    try {
      setIsLoading(true);
      // Fallback for dev mode where erpApi might not be bridged yet
      if (!window.erpApi) {
        console.warn('erpApi not found.');
        return;
      }
      
      const res = await window.erpApi.getBootstrap();
      const payload = unwrapIpcResponse(res);
      if (payload) {
        setData(payload);
      }
    } catch (err) {
      console.error("Failed to fetch bootstrap:", err);
      alert("Failed to fetch bootstrap: " + err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBootstrap();
  }, [fetchBootstrap]);

  // General wrapper for mutations that require a re-fetch
  const mutateAndRefresh = async (actionPromise) => {
    try {
      const res = await actionPromise;
      const payload = unwrapIpcResponse(res);
      await fetchBootstrap();
      return payload;
    } catch (err) {
      console.error("Mutation failed:", err);
      throw err;
    }
  };

  return (
    <AppContext.Provider value={{ data, isLoading, mutateAndRefresh, fetchBootstrap }}>
      {children}
    </AppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  return useContext(AppContext);
}
