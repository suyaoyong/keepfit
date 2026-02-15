const fs = require("fs");
const path = require("path");
const cloud = require("wx-server-sdk");
const seedBooks = require("./seed/books.qiutu.json");
const seedChapters = require("./seed/book_chapters.qiutu.json");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const SEED_ASSET_PREFIX = "seedasset://";

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  return { ok: false, error };
}

function ensureText(value) {
  return String(value || "").trim();
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const result = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

function replaceSeedAssetUrls(contentHtml, uploadedMap) {
  const raw = String(contentHtml || "");
  if (!raw || !uploadedMap || !Object.keys(uploadedMap).length) {
    return raw;
  }

  return raw.replace(/seedasset:\/\/([a-zA-Z0-9._-]+)/g, (full, key) => {
    return uploadedMap[key] || full;
  });
}

async function upsertBook(item) {
  const bookId = ensureText(item?.bookId);
  if (!bookId) {
    return;
  }

  const now = db.serverDate();
  const payload = {
    bookId,
    title: ensureText(item?.title) || "Untitled Book",
    author: ensureText(item?.author),
    coverUrl: ensureText(item?.coverUrl),
    intro: ensureText(item?.intro),
    chapterCount: Number(item?.chapterCount) || 0,
    status: ensureText(item?.status) || "ready",
    updatedAt: now,
  };

  const existing = await db.collection("books").where({ bookId }).limit(1).get();
  if (existing.data?.length) {
    await db.collection("books").doc(existing.data[0]._id).update({ data: payload });
  } else {
    await db.collection("books").add({ data: { ...payload, createdAt: now } });
  }
}

async function upsertChapter(item) {
  const bookId = ensureText(item?.bookId);
  const chapterNo = Number(item?.chapterNo);
  if (!bookId || !Number.isFinite(chapterNo) || chapterNo <= 0) {
    return;
  }

  const now = db.serverDate();
  const payload = {
    bookId,
    chapterNo,
    chapterTitle: ensureText(item?.chapterTitle) || `Chapter ${chapterNo}`,
    contentHtml: String(item?.contentHtml || ""),
    wordCount: Number(item?.wordCount) || 0,
    imageCount: Number(item?.imageCount) || 0,
    updatedAt: now,
  };

  const existing = await db.collection("book_chapters").where({ bookId, chapterNo }).limit(1).get();
  if (existing.data?.length) {
    await db.collection("book_chapters").doc(existing.data[0]._id).update({ data: payload });
  } else {
    await db.collection("book_chapters").add({ data: { ...payload, createdAt: now } });
  }
}

async function uploadSeedCover(bookId) {
  const localPath = path.join(__dirname, "seed", "qiutu-cover.jpg");
  if (!fs.existsSync(localPath)) {
    return "";
  }

  const fileContent = fs.readFileSync(localPath);
  const cloudPath = `library/covers/${bookId || "qiutujianshen"}/cover-${Date.now()}.jpg`;
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent,
  });

  return ensureText(uploadRes?.fileID);
}

async function uploadSeedAssets(bookId) {
  const rootDir = path.join(__dirname, "seed", "assets", bookId);
  const files = walkFiles(rootDir);
  if (!files.length) {
    return {};
  }

  const uploadedMap = {};
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const cloudPath = `library/books/${bookId}/assets/${fileName}`;

    // eslint-disable-next-line no-await-in-loop
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: fs.readFileSync(filePath),
    });

    uploadedMap[fileName] = ensureText(uploadRes?.fileID);
  }

  return uploadedMap;
}

exports.main = async (event) => {
  const action = ensureText(event?.action);
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!action) {
    return fail("missing action");
  }

  try {
    if (action === "listBooks") {
      const res = await db.collection("books").orderBy("updatedAt", "desc").limit(50).get();
      const books = (res.data || []).map((item) => ({
        bookId: item.bookId || item._id,
        title: item.title || "Untitled Book",
        author: item.author || "",
        coverUrl: item.coverUrl || "",
        intro: item.intro || "",
        chapterCount: Number(item.chapterCount) || 0,
        status: item.status || "ready",
        updatedAt: item.updatedAt || null,
      }));
      return ok({ books });
    }

    if (action === "getBookDetail") {
      const bookId = ensureText(event?.bookId);
      if (!bookId) {
        return fail("missing bookId");
      }

      const bookRes = await db.collection("books").where({ bookId }).limit(1).get();
      const book = bookRes.data?.[0] || null;
      if (!book) {
        return fail("book not found");
      }

      const chapterRes = await db
        .collection("book_chapters")
        .where({ bookId })
        .orderBy("chapterNo", "asc")
        .limit(1000)
        .get();

      let progress = null;
      if (openid) {
        const progRes = await db.collection("book_progress").where({ openid, bookId }).limit(1).get();
        progress = progRes.data?.[0] || null;
      }

      const chapters = (chapterRes.data || []).map((item) => ({
        chapterNo: Number(item.chapterNo) || 0,
        chapterTitle: item.chapterTitle || `Chapter ${item.chapterNo}`,
        wordCount: Number(item.wordCount) || 0,
        imageCount: Number(item.imageCount) || 0,
      }));

      return ok({
        book: {
          bookId: book.bookId || book._id,
          title: book.title || "Untitled Book",
          author: book.author || "",
          coverUrl: book.coverUrl || "",
          intro: book.intro || "",
          chapterCount: Number(book.chapterCount) || chapters.length,
          status: book.status || "ready",
        },
        chapters,
        progress: progress
          ? {
              chapterNo: Number(progress.chapterNo) || 1,
              scrollTop: Number(progress.scrollTop) || 0,
              updatedAt: progress.updatedAt || null,
            }
          : null,
      });
    }

    if (action === "getChapter") {
      const bookId = ensureText(event?.bookId);
      const chapterNo = Number(event?.chapterNo);
      if (!bookId || !Number.isFinite(chapterNo) || chapterNo <= 0) {
        return fail("invalid params");
      }

      const res = await db.collection("book_chapters").where({ bookId, chapterNo }).limit(1).get();
      const chapter = res.data?.[0] || null;
      if (!chapter) {
        return fail("chapter not found");
      }

      return ok({
        bookId,
        chapterNo,
        chapterTitle: chapter.chapterTitle || `Chapter ${chapterNo}`,
        contentHtml: chapter.contentHtml || "",
        wordCount: Number(chapter.wordCount) || 0,
        imageCount: Number(chapter.imageCount) || 0,
      });
    }

    if (action === "getProgress") {
      if (!openid) {
        return fail("missing openid");
      }

      const bookId = ensureText(event?.bookId);
      if (!bookId) {
        return fail("missing bookId");
      }

      const res = await db.collection("book_progress").where({ openid, bookId }).limit(1).get();
      const progress = res.data?.[0] || null;
      return ok(
        progress
          ? {
              chapterNo: Number(progress.chapterNo) || 1,
              scrollTop: Number(progress.scrollTop) || 0,
              updatedAt: progress.updatedAt || null,
            }
          : null
      );
    }

    if (action === "saveProgress") {
      if (!openid) {
        return fail("missing openid");
      }

      const bookId = ensureText(event?.bookId);
      const chapterNo = Number(event?.chapterNo);
      const scrollTop = Number(event?.scrollTop) || 0;
      if (!bookId || !Number.isFinite(chapterNo) || chapterNo <= 0) {
        return fail("invalid params");
      }

      const now = db.serverDate();
      const existing = await db.collection("book_progress").where({ openid, bookId }).limit(1).get();
      if (existing.data?.length) {
        await db.collection("book_progress").doc(existing.data[0]._id).update({
          data: {
            chapterNo,
            scrollTop,
            updatedAt: now,
          },
        });
      } else {
        await db.collection("book_progress").add({
          data: {
            openid,
            bookId,
            chapterNo,
            scrollTop,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      return ok({ saved: true });
    }

    if (action === "seedQiutu") {
      const expectedToken = ensureText(process.env.LIBRARY_SEED_TOKEN);
      const providedToken = ensureText(event?.seedToken);
      if (expectedToken && expectedToken !== providedToken) {
        return fail("invalid seedToken");
      }

      const defaultBookId = ensureText(seedBooks?.[0]?.bookId) || "qiutujianshen";
      const uploadedCoverUrl = await uploadSeedCover(defaultBookId);
      const uploadedAssets = await uploadSeedAssets(defaultBookId);

      for (const item of seedBooks) {
        const seededItem = { ...item };
        if (!ensureText(seededItem.coverUrl) && uploadedCoverUrl) {
          seededItem.coverUrl = uploadedCoverUrl;
        }
        // eslint-disable-next-line no-await-in-loop
        await upsertBook(seededItem);
      }

      for (const item of seedChapters) {
        const seededChapter = { ...item };
        seededChapter.contentHtml = replaceSeedAssetUrls(seededChapter.contentHtml, uploadedAssets);
        // eslint-disable-next-line no-await-in-loop
        await upsertChapter(seededChapter);
      }

      return ok({
        seeded: true,
        bookCount: seedBooks.length,
        chapterCount: seedChapters.length,
        coverUploaded: Boolean(uploadedCoverUrl),
        coverUrl: uploadedCoverUrl || "",
        assetUploadedCount: Object.keys(uploadedAssets).length,
        assetPrefix: SEED_ASSET_PREFIX,
      });
    }

    return fail("unsupported action");
  } catch (error) {
    return fail(error?.message || "library function error");
  }
};