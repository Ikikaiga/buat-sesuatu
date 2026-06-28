import cv2
import mediapipe as mp


def is_fist(hand_landmarks):
    lm = hand_landmarks.landmark

    finger_tips = [8, 12, 16, 20]
    finger_pips = [6, 10, 14, 18]

    closed_count = 0
    for tip, pip in zip(finger_tips, finger_pips):
        if lm[tip].y > lm[pip].y:
            closed_count += 1

    thumb_tip = lm[4]
    thumb_ip = lm[3]
    thumb_mcp = lm[2]
    if abs(thumb_tip.x - thumb_mcp.x) < abs(thumb_ip.x - thumb_mcp.x):
        closed_count += 1

    return closed_count >= 4


def main():
    mp_hands = mp.solutions.hands
    mp_draw = mp.solutions.drawing_utils

    hands = mp_hands.Hands(
        max_num_hands=2,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.5,
    )

    landmark_style = mp_draw.DrawingSpec(color=(0, 255, 0), thickness=2, circle_radius=3)
    connection_style = mp_draw.DrawingSpec(color=(255, 255, 255), thickness=2)

    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("Error: Tidak bisa membuka kamera.")
        return

    print("Kamera aktif. Tekan 'q' untuk keluar.")

    while True:
        ret, frame = cap.read()

        if not ret:
            print("Error: Gagal membaca frame dari kamera.")
            break

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)

        hand_detected = False
        fist_detected = False

        if results.multi_hand_landmarks:
            hand_detected = True
            for hand_landmarks in results.multi_hand_landmarks:
                if is_fist(hand_landmarks):
                    fist_detected = True

        if hand_detected and not fist_detected:
            frame = cv2.GaussianBlur(frame, (55, 55), 0)

        cv2.imshow("Kamera", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    hands.close()
    cap.release()
    cv2.destroyAllWindows()
    print("Kamera dimatikan.")


if __name__ == "__main__":
    main()
