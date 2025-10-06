import os
import uuid
import cv2
import numpy as np
from flask import Flask, request, jsonify
from tensorflow.keras.models import load_model
from PIL import Image
from flask_cors import CORS
from werkzeug.utils import secure_filename

# --- Config ---
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
FRAME_COUNT = 10  # frames per video
ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "bmp", "gif"}
ALLOWED_VIDEO_EXTS = {"mp4", "mov", "avi", "webm", "mkv"}

# optional: limit max upload size (200 MB)
MAX_CONTENT_LENGTH = 200 * 1024 * 1024

# --- Load Model ---
image_model = None
try:
    image_model = load_model("model/image_model.keras")
    # If the loaded model has a trainable attribute
    try:
        image_model.trainable = False
    except Exception:
        pass
    print("Model loaded successfully")
except Exception as e:
    print("Could not load model:", e)
    image_model = None

# --- Flask App ---
app = Flask(__name__)
CORS(app)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# --- Helper: Extract frames ---
def extract_frames(video_path, num_frames=FRAME_COUNT):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Unable to open video file")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        cap.release()
        raise ValueError("Video contains no frames")

    step = max(1, total_frames // num_frames)
    frames = []
    count = 0

    while len(frames) < num_frames and cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        if count % step == 0:
            try:
                frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frame = Image.fromarray(frame).resize((224, 224))
                frames.append(np.array(frame) / 255.0)
            except Exception:
                # skip bad frames
                pass
        count += 1

    cap.release()

    if len(frames) == 0:
        raise ValueError("No valid frames could be extracted from video")

    # If fewer than requested, repeat last frame
    while len(frames) < num_frames:
        frames.append(frames[-1])

    return np.array(frames)

# --- Predict ---
def predict_file(file_path, file_type="video"):
    if image_model is None:
        # Return a safe fallback so the server remains usable for testing when the model
        # could not be loaded. This avoids 500 errors during development.
        print("Warning: model not loaded, returning fallback response")
        return {"label": "Unknown", "confidence": 0.0, "model_loaded": False}

    if file_type == "video":
        frames = extract_frames(file_path)
    else:  # image
        img = Image.open(file_path).convert("RGB").resize((224, 224))
        frames = np.expand_dims(np.array(img) / 255.0, axis=0)

    # Ensure frames are a numpy array
    frames = np.array(frames)

    # Attempt prediction
    preds = image_model.predict(frames)
    preds = np.array(preds).squeeze()

    # If model returns a single score per input or multiple, normalize accordingly
    if preds.ndim == 0:
        avg_pred = float(preds)
    else:
        avg_pred = float(np.mean(preds))

    label = "AI-Generated" if avg_pred >= 0.5 else "Real"
    confidence = float(avg_pred if avg_pred >= 0.5 else 1 - avg_pred)
    return {"label": label, "confidence": confidence}

# --- Routes ---
@app.route("/predict", methods=["POST"])
def predict():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    filename = secure_filename(file.filename or f"upload_{uuid.uuid4().hex}")
    if "." in filename:
        ext = filename.rsplit(".", 1)[1].lower()
    else:
        ext = ""

    # Determine type
    if ext in ALLOWED_IMAGE_EXTS:
        file_type = "image"
    else:
        # treat unknown as video for now
        file_type = "video"

    filepath = os.path.join(UPLOAD_FOLDER, f"{uuid.uuid4().hex}_{filename}")
    try:
        file.save(filepath)
        result = predict_file(filepath, file_type=file_type)
        return jsonify(result)
    except RuntimeError as re:
        return jsonify({"error": str(re)}), 500
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        print("Error during prediction:", e)
        return jsonify({"error": "Internal server error"}), 500
    finally:
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except Exception:
            pass

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
