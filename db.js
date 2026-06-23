/**
 * db.js — Promised-based IndexedDB Persistence Wrapper
 *
 * Manages database initialization, migrations, and transactional saving/loading
 * of Cutout Collage projects and slides.
 */

const DB_NAME = 'CutoutCollageDB';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 1. Projects Store
            if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects', { keyPath: 'id' });
            }

            // 2. Slides Store (linked to projectId)
            if (!db.objectStoreNames.contains('slides')) {
                const slidesStore = db.createObjectStore('slides', { keyPath: 'id' });
                slidesStore.createIndex('projectId', 'projectId', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            console.error('[db] Error opening IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });

    return dbPromise;
}

/**
 * Fetch all saved projects sorted by updatedAt descending.
 */
export async function getProjects() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readonly');
        const store = transaction.objectStore('projects');
        const request = store.getAll();

        request.onsuccess = () => {
            const projects = request.result || [];
            // Sort by updatedAt descending
            projects.sort((a, b) => b.updatedAt - a.updatedAt);
            resolve(projects);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/**
 * Save project metadata (id, name, settings, timestamps).
 */
export async function saveProject(project) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite');
        const store = transaction.objectStore('projects');
        
        project.updatedAt = Date.now();
        if (!project.createdAt) {
            project.createdAt = project.updatedAt;
        }

        const request = store.put(project);

        request.onsuccess = () => {
            resolve(project);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/**
 * Fetch a single project metadata by ID.
 */
export async function getProject(projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readonly');
        const store = transaction.objectStore('projects');
        const request = store.get(projectId);

        request.onsuccess = () => {
            resolve(request.result || null);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/**
 * Delete a project and all its associated slides.
 */
export async function deleteProject(projectId) {
    const db = await openDb();
    
    // Delete project slides first
    await deleteSlidesForProject(projectId);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.delete(projectId);

        request.onsuccess = () => {
            resolve(true);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/**
 * Get all slides for a specific project, sorted by order index.
 */
export async function getSlides(projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('slides', 'readonly');
        const store = transaction.objectStore('slides');
        const index = store.index('projectId');
        const request = index.getAll(projectId);

        request.onsuccess = () => {
            const slides = request.result || [];
            // Sort by manual reordering index
            slides.sort((a, b) => a.index - b.index);
            resolve(slides);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/**
 * Save all slides for a project. Deletes existing ones for the project
 * first to avoid orphan slides.
 */
export async function saveSlides(projectId, slides) {
    const db = await openDb();
    
    // Clear old slides first to ensure no duplicates or leftovers
    await deleteSlidesForProject(projectId);

    if (slides.length === 0) return;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction('slides', 'readwrite');
        const store = transaction.objectStore('slides');

        let index = 0;
        let count = 0;
        let hasError = false;

        slides.forEach((slide) => {
            const record = {
                id: slide.id,
                projectId: projectId,
                index: index++,
                imgBlob: slide.imgBlob,     // Original image (Blob)
                maskBlob: slide.maskBlob,   // Mask image (Blob)
                text: slide.text,           // Caption string
                rotation: slide.rotation    // Rotation angle
            };

            const request = store.put(record);

            request.onsuccess = () => {
                count++;
                if (count === slides.length && !hasError) {
                    resolve(true);
                }
            };

            request.onerror = () => {
                if (!hasError) {
                    hasError = true;
                    reject(request.error);
                }
            };
        });
    });
}

/**
 * Helper to delete all slides associated with a project.
 */
export async function deleteSlidesForProject(projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('slides', 'readwrite');
        const store = transaction.objectStore('slides');
        const index = store.index('projectId');
        const request = index.openCursor(projectId);

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve(true);
            }
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}
