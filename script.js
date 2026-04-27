"use strict";

const APP = {
    koreaCenter: null,
    map: null,
    roadview: null,
    roadviewClient: null,
    guessMarker: null,
    answerMarker: null,
    resultLine: null,
    selectedPosition: null,
    answerPosition: null,
    difficulty: "Easy",
    roundId: 0
};

const DIFFICULTIES = {
    Easy: {
        minLat: 36.814610,
        maxLat: 37.655218,
        minLng: 126.571648,
        maxLng: 127.322527
    },
    Medium: {
        minLat: 34.943784,
        maxLat: 36.814610,
        minLng: 126.571648,
        maxLng: 127.150976
    },
    Hard: {
        minLat: 34.577897,
        maxLat: 37.945222,
        minLng: 126.482257,
        maxLng: 129.406354
    }
};

const elements = {};

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function distanceKm(first, second) {
    const earthRadiusKm = 6371.0088;
    const lat1 = toRadians(first.getLat());
    const lat2 = toRadians(second.getLat());
    const latDelta = lat2 - lat1;
    const lngDelta = toRadians(second.getLng() - first.getLng());
    const a = Math.sin(latDelta / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;

    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreFromDistance(km) {
    return Math.max(0, Math.round(5000 * Math.exp(-km / 150)));
}

function formatKm(km) {
    if (km < 1) {
        return `${Math.round(km * 1000)} m`;
    }

    return `${km.toFixed(2)} km`;
}

function setMessage(message) {
    elements.answerText.textContent = message;
}

function setDifficulty(difficulty) {
    APP.difficulty = difficulty;
    elements.difficultyText.textContent = `Difficulty: ${difficulty}`;

    document.querySelectorAll(".difficulty-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.difficulty === difficulty);
    });

    startRound();
}

function randomPositionForDifficulty() {
    const bounds = DIFFICULTIES[APP.difficulty];

    return new kakao.maps.LatLng(
        randomBetween(bounds.minLat, bounds.maxLat),
        randomBetween(bounds.minLng, bounds.maxLng)
    );
}

function getNearestPanoId(position, radiusMeters) {
    return new Promise((resolve) => {
        APP.roadviewClient.getNearestPanoId(position, radiusMeters, resolve);
    });
}

function waitForRoadviewPosition(expectedPanoId) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId = null;
        const cleanup = () => {
            window.clearTimeout(timeoutId);
            kakao.maps.event.removeListener(APP.roadview, "panoid_changed", done);
            kakao.maps.event.removeListener(APP.roadview, "position_changed", done);
        };
        const done = () => {
            if (settled) {
                return;
            }

            if (APP.roadview.getPanoId() !== expectedPanoId) {
                return;
            }

            const position = APP.roadview.getPosition();
            if (!position) {
                return;
            }

            settled = true;
            cleanup();
            resolve(position);
        };

        kakao.maps.event.addListener(APP.roadview, "panoid_changed", done);
        kakao.maps.event.addListener(APP.roadview, "position_changed", done);
        window.setTimeout(done, 750);
        window.setTimeout(done, 1500);
        timeoutId = window.setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            reject(new Error("The Kakao roadview panorama did not finish loading."));
        }, 8000);
    });
}

async function findRoadviewPosition() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const position = randomPositionForDifficulty();
        const panoId = await getNearestPanoId(position, 1000);

        if (panoId) {
            return { panoId, position };
        }
    }

    throw new Error("Could not find a nearby Kakao roadview panorama.");
}

function clearRoundMarkers() {
    APP.selectedPosition = null;
    APP.answerPosition = null;
    APP.guessMarker.setVisible(false);

    if (APP.answerMarker) {
        APP.answerMarker.setMap(null);
        APP.answerMarker = null;
    }

    if (APP.resultLine) {
        APP.resultLine.setMap(null);
        APP.resultLine = null;
    }
}

async function startRound() {
    const roundId = APP.roundId + 1;
    APP.roundId = roundId;

    clearRoundMarkers();
    APP.map.setCenter(APP.koreaCenter);
    APP.map.setLevel(13);
    setMessage("Loading a place...");

    try {
        const result = await findRoadviewPosition();
        if (roundId !== APP.roundId) {
            return;
        }

        APP.roadview.setPanoId(result.panoId, result.position);
        APP.answerPosition = await waitForRoadviewPosition(result.panoId);

        if (roundId === APP.roundId) {
            setMessage("Click the map, then submit your answer.");
        }
    } catch (error) {
        if (roundId === APP.roundId) {
            setMessage(error.message);
        }
    }
}

function submitAnswer() {
    if (!APP.answerPosition) {
        setMessage("The roadview is still loading.");
        return;
    }

    if (!APP.selectedPosition) {
        setMessage("Please click a position on the map first.");
        return;
    }

    const km = distanceKm(APP.selectedPosition, APP.answerPosition);
    const score = scoreFromDistance(km);

    if (APP.answerMarker) {
        APP.answerMarker.setMap(null);
    }

    if (APP.resultLine) {
        APP.resultLine.setMap(null);
    }

    APP.answerMarker = new kakao.maps.Marker({
        map: APP.map,
        position: APP.answerPosition
    });

    APP.resultLine = new kakao.maps.Polyline({
        map: APP.map,
        path: [APP.selectedPosition, APP.answerPosition],
        strokeWeight: 3,
        strokeColor: "#d64545",
        strokeOpacity: 0.9,
        strokeStyle: "solid"
    });

    const resultBounds = new kakao.maps.LatLngBounds();
    resultBounds.extend(APP.selectedPosition);
    resultBounds.extend(APP.answerPosition);
    APP.map.setBounds(resultBounds);

    setMessage(`You were ${formatKm(km)} away. Score: ${score} / 5000.`);
}

function initMap() {
    APP.koreaCenter = new kakao.maps.LatLng(36.5, 128);
    APP.map = new kakao.maps.Map(elements.map, {
        center: APP.koreaCenter,
        level: 13
    });

    APP.guessMarker = new kakao.maps.Marker({
        map: APP.map,
        position: new kakao.maps.LatLng(0, 0)
    });
    APP.guessMarker.setVisible(false);

    kakao.maps.event.addListener(APP.map, "click", (mouseEvent) => {
        APP.selectedPosition = mouseEvent.latLng;
        APP.guessMarker.setPosition(APP.selectedPosition);
        APP.guessMarker.setVisible(true);
    });
}

function initRoadview() {
    APP.roadview = new kakao.maps.Roadview(elements.roadview);
    APP.roadviewClient = new kakao.maps.RoadviewClient();
}

function bindEvents() {
    elements.submitButton.addEventListener("click", submitAnswer);

    document.querySelectorAll(".difficulty-button").forEach((button) => {
        button.addEventListener("click", () => setDifficulty(button.dataset.difficulty));
    });
}

function init() {
    elements.map = document.getElementById("map");
    elements.roadview = document.getElementById("roadview");
    elements.answerText = document.getElementById("answer-text");
    elements.difficultyText = document.getElementById("difficulty-text");
    elements.submitButton = document.getElementById("submit-button");

    initMap();
    initRoadview();
    bindEvents();
    startRound();
}

window.KoreaMapGuess = {
    distanceKm,
    scoreFromDistance
};

if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
    kakao.maps.load(init);
} else {
    document.addEventListener("DOMContentLoaded", () => {
        const answerText = document.getElementById("answer-text");
        if (answerText) {
            answerText.textContent = "Kakao Maps failed to load. Check the JavaScript key, web platform domain, and Kakao Map activation.";
        }
    });
}
