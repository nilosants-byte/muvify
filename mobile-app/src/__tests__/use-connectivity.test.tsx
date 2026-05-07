import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import * as Network from "expo-network";
import { useConnectivity } from "../state/useConnectivity";

jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn()
}));

let hookState = {} as ReturnType<typeof useConnectivity>;

function Probe() {
  hookState = useConnectivity(1000);
  return null;
}

describe("useConnectivity", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("marca offline quando não ha conectividade e permite rechecagem manual", async () => {
    const getNetworkStateAsync = Network.getNetworkStateAsync as jest.Mock;
    getNetworkStateAsync
      .mockResolvedValueOnce({
        isConnected: false,
        isInternetReachable: false
      })
      .mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true
      });

    render(<Probe />);

    await waitFor(() => expect(hookState.online).toBe(false));
    expect(hookState.checking).toBe(false);

    await act(async () => {
      await hookState.recheckNow();
    });

    expect(hookState.online).toBe(true);
  });

  it("executa polling periodico", async () => {
    const getNetworkStateAsync = Network.getNetworkStateAsync as jest.Mock;
    getNetworkStateAsync.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true
    });

    render(<Probe />);
    await waitFor(() => expect(getNetworkStateAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(getNetworkStateAsync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});


