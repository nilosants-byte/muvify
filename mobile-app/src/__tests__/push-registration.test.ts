import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { getPushRegistrationPayload } from "../services/notifications/push";

describe("push registration", () => {
  const originalProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

  beforeEach(() => {
    (Device as { isDevice: boolean }).isDevice = true;
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
      data: "ExponentPushToken[testPushToken123]"
    });
    delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID = originalProjectId;
  });

  it("returns null when user denies notification permission", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });

    const payload = await getPushRegistrationPayload();

    expect(payload).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("requests push token with explicit projectId from env", async () => {
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID = "project_test_123";

    const payload = await getPushRegistrationPayload();

    expect(payload).toMatchObject({
      token: "ExponentPushToken[testPushToken123]"
    });
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "project_test_123"
    });
  });

  it("handles token retrieval error and returns null", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error("expo unavailable")
    );

    const payload = await getPushRegistrationPayload();
    expect(payload).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
