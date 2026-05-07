import * as Network from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";

export function useConnectivity(pollingMs = 5000, trackChecking = true) {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const checkNow = useCallback(async () => {
    if (!mountedRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    if (trackChecking) {
      setChecking(true);
    }

    try {
      const state = await Network.getNetworkStateAsync();
      if (!mountedRef.current) return;

      const isConnected = state.isConnected ?? false;
      const hasInternet = state.isInternetReachable ?? true;
      setOnline(isConnected && hasInternet);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current && trackChecking) {
        setChecking(false);
      }
    }
  }, [trackChecking]);

  useEffect(() => {
    mountedRef.current = true;
    checkNow();
    const interval = setInterval(checkNow, pollingMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [checkNow, pollingMs]);

  return { online, checking, recheckNow: checkNow };
}


