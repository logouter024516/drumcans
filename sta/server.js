import express from "express";
import multer from "multer";
import fs from "fs/promises";
import fsSync from "fs";
import OpenAI from "openai";
import dotenv from "dotenv";
import { MongoClient, GridFSBucket, ObjectId } from "mongodb";



// pdfjs-dist의 일반 ES Module 빌드를 임포트합니다.
// 이 파일이 Node.js 환경에서 PDF.js의 핵심 기능을 제공합니다.
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

// Node.js 환경에서 파일 경로를 다루기 위한 유틸리티 모듈 임포트
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 현재 파일(server.js)의 절대 경로를 기반으로 __dirname을 설정합니다.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PDF.js 워커 파일의 절대 경로를 설정합니다.
// 이 경로가 Node.js가 워커 스크립트를 찾을 수 있도록 합니다.
// 'node_modules' 폴더 안에 'pdfjs-dist/build/pdf.worker.mjs' 파일이 있는지 확인해 주세요.
pdfjsLib.GlobalWorkerOptions.workerSrc = join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.js');

dotenv.config({ path: join(__dirname, '.env'), override: true });


console.log("process.env.OPEN_KEY = ", process.env.OPENAI_API_KEY);


const app = express();
const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let dbClient;
let gptFilesDb;
let filesBucket;

async function connectDB() {
  try {
    dbClient = new MongoClient(process.env.MONGO_URI);
    await dbClient.connect();
    gptFilesDb = dbClient.db("gptfiles");
    filesBucket = new GridFSBucket(gptFilesDb, { bucketName: "files" });
    console.log("MongoDB에 성공적으로 연결되었습니다.");
  } catch (error) {
    console.error("MongoDB 연결 오류:", error);
    process.exit(1);
  }
}

app.use(express.static("public"));

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("파일이 업로드되지 않았습니다.");
    }

    const file = req.file;
    let fileId;

    const readStream = fsSync.createReadStream(file.path);
    const uploadStream = filesBucket.openUploadStream(file.originalname, {
      chunkSizeBytes: 1024 * 255,
      contentType: file.mimetype,
    });

    readStream.on("error", (err) => {
      console.error("읽기 스트림 오류:", err);
      fs.unlink(file.path).catch(unlinkErr => console.error("임시 파일 정리 실패:", unlinkErr));
      res.status(500).send("업로드된 파일을 읽는 중 오류가 발생했습니다.");
    });

    uploadStream.on("error", (err) => {
      console.error("GridFS 업로드 오류:", err);
      fs.unlink(file.path).catch(unlinkErr => console.error("임시 파일 정리 실패:", unlinkErr));
      res.status(500).send("파일을 스토리지에 업로드하는 중 오류가 발생했습니다.");
    });

    readStream.pipe(uploadStream);

    uploadStream.on("finish", async () => {
      fileId = uploadStream.id;

      try {
        await fs.unlink(file.path);
      } catch (err) {
        console.error("임시 파일 삭제 실패:", err);
      }

      const chunks = [];
      const downloadStream = filesBucket.openDownloadStream(fileId);

      downloadStream.on("data", (chunk) => chunks.push(chunk));
      downloadStream.on("error", (err) => {
        console.error("GridFS 다운로드 오류:", err);
        res.status(500).send("스토리지에서 파일을 다운로드하는 중 오류가 발생했습니다.");
      });
      downloadStream.on("end", async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const uint8array = new Uint8Array(buffer);

          // PDF 텍스트 추출 부분 (pdfjs-dist 사용)
          const loadingTask = pdfjsLib.getDocument({ data: uint8array });
          const pdfDocument = await loadingTask.promise;
          let text = '';

          for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            text += textContent.items.map(item => item.str).join(' ') + '\n';
          }

          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.flushHeaders();

          const prompt = `
아래에 텍스트형식으로 제공되는 문장을 읽고, AI가 작성했을것으로 의심되는 확률과 의심되는 문장을 JSON 형식으로 출력하세요.
입력예시: 
편의점   매출   데이터를   활용한   매출   예측   모델   개발  Predictive   Sales   Modeling   for   Convenience   Stores   Using   Machine   Learning  Techniques  1.   서론  1.1   연구   배경  편의점   산업은   24 시간   운영 ,   접근성 ,   다양한   상품군으로   인해   국내   소매   시장에서   중요한   위  치를   차지하고    있다 .   본   연구는   매출   데이터를   기반으로   머신러닝   기법을   활용해   미래   매출을  예측함으로써 ,   편의점   운영   효율성   향상과   재고   관리   최 적화를   도모하고자   한다 .  1.2   연구   목적  본   논문은   공공   편의점   매출   데이터를   활용하여   시계열   기반   매출   예측   모델을   개발하고 ,   다  양한   머신러닝   기법의   성능을   비교함으로써   실제   활용   가능성을   제시하는   것을   목적으로   한  다 .  2.   관련   연구  국내외에서   시계열   예측을   위한   머신러닝   기법은   활발히   연구되어   왔다 .   대표적으로   ARIMA  모델 ,   LSTM(Long   Short-Term   Memory),   Random   Forest,   XGBoost   등이   있다 .   특히  LSTM 은   시간에   따른   데이터를   처리하는   데   강점을   가지며 ,   기존   통계적   모델보다   높은   정확  도를   보인다는   연구가   다수   존재한다 .  3.   데이터   및   연구   방법  3.1   데이터   설명  본   연구에서는   kaggle 에서   제공하는   “Rossmann   Store   Sales”   데이터셋을   수정   활용하였다 .  주요   속성은   Date,   Store,   Sales,   Promo,   DayOfWeek,   SchoolHoliday   등이다 .  3.2   전처리   과정  -   결측값   제거   및   이상치   처리  -   요일 ,   공휴일   등   범주형   변수   →   One-hot   Encoding  -   시계열   정렬   및   주   단위   집계  3.3   모델   구성  -   Baseline:   평균   매출   예측  -   Random   Forest   Regressor  -   XGBoost   Regressor  -   LSTM   (TensorFlow   기반 )  4.   분석   및   실험   결과
4.1   평가   지표 :   RMSE,   MAE  모델   성능   비교 :  -   Baseline:   RMSE   1453.2   /   MAE   1044.5  -   Random   Forest:   RMSE   1180.3   /   MAE   873.1  -   XGBoost:   RMSE   1123.5   /   MAE   845.7  -   LSTM:   RMSE   1014.7   /   MAE   792.3  LSTM   모델이   가장   낮은   RMSE 와   MAE 를   기록하였다 .  5.   결론   및   향후   과제  본   연구에서는   머신러닝   모델을   통해   편의점   매출을   예측하고 ,   다양한   모델의   성능을   비교하  였다 .   결과적으로   LSTM   기 반   모델이   가장   높은   예측   성능을   보였으며 ,   이는   실시간   재고   및  물류   관리에   활용   가능함을   시사한다 .  향후   연구에서는   외부   요인 ( 날씨 ,   지역   이벤트   등 ) 을   포함한   다변량   예측 ,   모델   경량화   및   실  제   적용   가능성   탐색이   필요하다 .  6.   참고   문헌  [1]   Hochreiter,   S.,   &   Schmidhuber,   J.   (1997).   Long   short-term   memory.   Neural  computation,   9(8),   1735-1780.  [2]   Brownlee,   J.   (2017).   Deep   Learning   for   Time   Series   Forecasting.   Machine  Learning   Mastery.  [3]   Kaggle.   (2023).   Rossmann   Store   Sales   Dataset.  https://www.kaggle.com/c/rossmann-store-sales

출력 형식 예시:
{
  "ai_probability": 85,
  "suspicious_sentences": ["3.1   데이터   설명  본   연구에서는   kaggle 에서   제공하는   “Rossmann   Store   Sales”   데이터셋을   수정   활용하였다 .  주요   속성은   Date,   Store,   Sales,   Promo,   DayOfWeek,   SchoolHoliday   등이다 .", "이는   실시간   재고   및  물류   관리에   활용   가능함을   시사한다 .  향후   연구에서는   외부   요인 ( 날씨 ,   지역   이벤트   등 ) 을   포함한   다변량   예측 , 그 외 의심되는 문장"]
}
텍스트:
${text}
`;
          console.log(text);
          const completionStream = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            stream: true,
          });

          for await (const chunk of completionStream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              res.write(content);
            }
          }
          res.end();
        } catch (err) {
          console.error("PDF 파싱 또는 GPT 호출 중 오류:", err);
          res.status(500).send("서버 처리 중 오류가 발생했습니다.");
        }
      });
    });
  } catch (err) {
    console.error("처리되지 않은 서버 오류:", err);
    res.status(500).send("알 수 없는 서버 오류가 발생했습니다.");
  }
});

connectDB().then(() => {
  app.listen(3000, () => {
    console.log("서버 시작됨: http://localhost:3000");
  });
});