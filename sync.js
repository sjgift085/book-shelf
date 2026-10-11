// 구글 로그인 + Firestore로 여러 기기의 책 목록을 맞춤.
// 책 하나 = users/{uid}/books/{책 id} 문서 하나. 삭제한 책은 { deleted: true }로 남겨 다른 기기에도 전달함.
import { firebaseConfig } from './firebase-config.js?v=7';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const btn = document.getElementById('syncBtn');

const STATUS = {
  out: ['☁️ 로그인', '구글 계정으로 로그인하면 다른 기기와 책 목록이 동기화돼요'],
  syncing: ['☁️ 동기화 중…', '동기화하고 있어요'],
  on: ['☁️ 동기화됨', ''],
  error: ['⚠️ 동기화 오류', '동기화에 실패했어요. 눌러서 다시 시도하거나 로그아웃할 수 있어요'],
};

function setStatus(key, email = '') {
  const [label, title] = STATUS[key];
  btn.textContent = label;
  btn.title = key === 'on' ? `${email} 계정으로 동기화 중` : title;
  btn.dataset.state = key;
}

if (firebaseConfig && window.bookshelf) {
  start().catch((err) => {
    console.error('동기화를 시작하지 못했어요', err);
    btn.hidden = false;
    setStatus('error');
    btn.onclick = () => location.reload();
  });
}

async function start() {
  const [{ initializeApp }, authSdk, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = fs.getFirestore(app);

  let user = null;
  let unsubscribe = null;
  btn.hidden = false;
  setStatus('out');

  async function signIn() {
    const provider = new authSdk.GoogleAuthProvider();
    try {
      await authSdk.signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === 'auth/popup-blocked') {
        await authSdk.signInWithRedirect(auth, provider);
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error(err);
        alert(`로그인하지 못했어요. (${err.code || err.message})`);
      }
    }
  }

  btn.onclick = async () => {
    if (!user) return signIn();
    const state = btn.dataset.state;
    if (state === 'error' && confirm('동기화에 실패했어요. 다시 시도할까요?\n(취소를 누르면 로그아웃할지 물어봐요)')) {
      location.reload();
      return;
    }
    if (confirm(`${user.email} 계정으로 동기화하고 있어요.\n로그아웃할까요? (이 기기에 있는 책 목록은 그대로 남아요)`)) {
      await authSdk.signOut(auth);
    }
  };

  authSdk.onAuthStateChanged(auth, (u) => {
    user = u;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    window.bookshelfSync = null;
    if (!u) {
      setStatus('out');
      return;
    }

    setStatus('syncing');
    const books = fs.collection(db, 'users', u.uid, 'books');

    async function push({ books: changed, deleted }) {
      const writes = [
        ...changed.map((b) => [b.id, { ...b }]),
        ...deleted.map((d) => [d.id, { deleted: true, updatedAt: d.updatedAt }]),
      ];
      // 한 번에 쓸 수 있는 문서 수(500)를 넘지 않게 나눠서 씀
      for (let i = 0; i < writes.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const [id, data] of writes.slice(i, i + 400)) batch.set(fs.doc(books, id), data);
        await batch.commit();
      }
    }

    function safePush(changes) {
      if (!changes.books.length && !changes.deleted.length) return;
      setStatus('syncing');
      push(changes)
        .then(() => { if (user === u) setStatus('on', u.email); })
        .catch((err) => {
          console.error('동기화 저장 실패', err);
          setStatus('error');
        });
    }

    window.bookshelfSync = { push: (changed, deleted) => safePush({ books: changed, deleted }) };

    unsubscribe = fs.onSnapshot(books, (snap) => {
      const toPush = window.bookshelf.mergeRemote(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
      if (toPush.books.length || toPush.deleted.length) safePush(toPush);
      else if (!snap.metadata.hasPendingWrites) setStatus('on', u.email);
    }, (err) => {
      console.error('동기화 읽기 실패', err);
      setStatus('error');
    });
  });
}
