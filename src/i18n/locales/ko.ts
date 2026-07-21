export default {
  // Common
  common: {
    cancel: '취소',
    confirm: '확인',
    close: '닫기',
    next: '다음',
    back: '뒤로',
    save: '저장',
    edit: '편집',
    delete: '삭제',
    add: '추가',
    copy: '복사',
    copied: '복사됨',
    loading: '로딩 중...',
    retry: '다시 시도',
    send: '보내기',
    receive: '받기',
    balance: '잔액',
    amount: '금액',
    min: '분',
    offlineRequired: '인터넷 연결이 필요합니다',
    memo: '메모',
    paste: '붙여넣기',
    change: '변경',
    search: '검색',
    reset: '초기화',
  },

  // Lock Screen
  lock: {
    enterPin: '잠금을 해제하려면 PIN을 입력하세요',
    wrongPin: 'PIN이 틀렸습니다. ({{remaining}}회 남음)',
    lockedOut: '{{attempts}}회 실패. {{minutes}}분 후 다시 시도하세요.',
    tryAgainIn: '{{time}} 후 다시 시도하세요',
    faceIdUnlock: 'Face ID로 잠금 해제',
    errorOccurred: '오류가 발생했습니다.',
    biometricFailed: '생체인증에 실패했습니다. PIN을 입력해주세요.',
  },

  // Onboarding
  onboarding: {
    // Welcome
    appName: 'Zappi',
    tagline: 'Bitcoin 결제를 쉽고 빠르게',
    createWallet: '신규 생성하기',
    securePrivateFast: 'Secure • Private • Fast',
    invitePlaceholder: '초대 코드',
    inviteInvalidCount: '올바르지 않은 초대 코드입니다 ({{current}}/{{max}})',
    inviteLocked: '시도 횟수를 초과했습니다. 5분 후 다시 시도해주세요.',

    // Mnemonic
    secretRecoveryKey: '복구문구',
    mnemonicWarning: '지갑을 복구할 수 있는 유일한 수단입니다.\n반드시 안전한 곳에 순서대로 기록해주세요.',
    copyToClipboard: '복사',
    regenerateMnemonic: '다시 생성',
    mnemonicSavedConfirm: '순서대로 안전한 곳에 기록했습니다',
    recordComplete: '다음',
    invalidMnemonic: '올바르지 않은 복구문구입니다. 단어를 다시 확인해주세요.',
    backupConfirmRequired: '복구문구를 기록했는지 확인해주세요.',

    // PIN
    enterNewPin: '6자리 PIN을 설정하세요',
    reenterPin: 'PIN을 다시 입력하세요',
    pinMismatch: 'PIN이 일치하지 않습니다',
    pinDigitsEntered: 'PIN {{total}}자리 중 {{count}}자리 입력됨',

    // Processing
    creatingWallet: '지갑 생성 중',
    creatingWalletDesc: '새 지갑을 생성하고 있습니다',
    pleaseWait: '잠시만 기다려주세요...',

    // Complete
    walletSetupFailed: '지갑 설정에 실패했습니다. 다시 시도해주세요.',
  },

  // Home Screen
  home: {
    showBalance: '잔액 표시',
    hideBalance: '잔액 숨기기',
    addFirstMint: '첫 번째 민트를 추가하세요',
    recentTransactions: '최근 거래',
    noTransactions: '거래내역이 없습니다',
    seeAll: '더보기',
  },

  // Action Buttons
  actions: {
    analytics: '활동 분석',
  },

  support: {
    title: '문의 내역',
    heroTitle: '무엇을 도와드릴까요?',
    unavailableTitle: '문의 기능이 설정되지 않았습니다',
    unavailableDescription: '이 빌드에서는 문의 기능을 사용할 수 없습니다. 공식 채널로 Zappi 팀에 문의해주세요.',
    connectionFailed: '문의 채널에 연결하지 못했습니다',
    tryAgainLater: '잠시 후 다시 시도해주세요.',
    composePageTitle: '문의하기',
    requestTitleLabel: '제목',
    requestBodyLabel: '내용',
    categoryLabel: '유형',
    categories: {
      // active (handoff)
      transfer: '송수신 관련',
      ecash: '이캐시 관련',
      fee: '수수료 관련',
      security: '보안 / 백업',
      other: '기타',
      // legacy — old tickets in storage may still carry these
      general: '일반',
      technical: '기술',
      billing: '결제',
      // idea
      idea_ux: 'UI / UX 개선',
      idea_feature: '신규 기능',
      idea_perf: '성능 / 안정성',
      idea_other: '기타',
    },
    createTicket: '등록하기',
    submittingTicket: '문의 등록 중입니다.',
    createFailed: '문의를 보내지 못했습니다',
    sendFailed: '메시지를 보내지 못했습니다',
    unreadBadge: 'NEW',
    noTickets: '문의 내역이 없습니다.',
    replyPlaceholder: '추가 메시지를 입력하세요',
    sendMessage: '메시지 보내기',
    teamName: 'Zappi team',
    attachFile: '파일 첨부',
    removeAttachment: '첨부파일 삭제',
    attachmentLimit: '파일은 최대 {{count}}개까지 첨부할 수 있습니다.',
    attachmentTooLarge: '파일은 {{size}} 이하만 첨부할 수 있습니다.',
    attachmentMetadataOnly: '파일 정보를 불러오는 중',
    downloadAttachment: '다운로드',
    replyToast: '"{{title}}"에 답변이 등록되었습니다.',
    leaveTicket: '나가기',
    deleteTicket: '문의 내역 삭제',
    deleteTitle: '문의에서 나갈까요?',
    deleted: '문의에서 나갔습니다.',
    deleteFailed: '문의에서 나가지 못했습니다',
    // CS system v2 (handoff)
    searchPlaceholder: '키워드로 검색해 보세요',
    csStatus: {
      received: '접수됨',
      progress: '진행중',
      answered: '상담 완료',
    },
    userBubbleLabel: '내가 보낸 문의',
    helpHomeSubtitle: '궁금한 점은 언제든 편하게 물어보세요.',
    faqTitle: '자주 묻는 질문',
    faqSeeAll: '전체 보기',
    faq: {
      q1: '민트가 무엇인가요?',
      a1: '민트는 인터넷 상의 은행이에요(eg 카카오뱅크, 케이뱅크). 민트는 라이트닝과 같은 비트코인 결제 인프라를 운영하며 결제와 이캐시 발급/소각 등의 업무를 수행해요. 기존 커스터디 모델과 다르게 캐슈 민트는 사용자의 거래내역을 추적하기가 극도로 힘들어요.',
      q2: '라이트닝 결제가 실패해요',
      a2: '라이트닝 결제는 여러 요인에 의해 실패할 수 있어요. 받는 사람의 라우팅 경로를 찾지 못하거나, 출발지와 도착지의 중간 Hop이 너무 많아 멀 경우에도 실패할 수 있어요. 계속해서 라이트닝 결제에 실패할 경우 민트에게 점검을 요청하는 것이 좋아요.',
      q3: '이캐시 토큰이 등록되지 않아요',
      a3: '이캐시 토큰이 이미 사용되었거나 토큰 생성 과정에서 에러가 발생한 경우 토큰이 등록되지 않을 수 있어요. 이런 경우 이캐시를 생성한 사람이 잔액 검증 기능을 활용해 수동으로 복구하여 다시 이캐시 토큰을 만들 수 있어요. 이캐시 금액이 이캐시 수취 수수료보다 작을 경우 수취가 불가능할 수 있어요. 향후 나중에 받기 기능을 통해 못 받는 토큰을 모아 한번에 등록하여 사용 가능하게 만들 계획이에요.',
      q4: '수수료는 어떻게 결정되나요?',
      a4: '라우팅 수수료는 라이트닝 결제 시 여러 노드를 거쳐가며 내는 일종의 통행료에요. 도착지까지의 경로에 따라 달라지며, 민트가 임의로 정하거나 조정할 수 있는 부분은 아니에요. 빠르고 편한 비트코인 결제 인프라를 이용하기 위해 자연스럽게 발생하는 비용이라고 보시면 돼요.\n\n스왑 수수료는 민트가 안정적인 인프라 운영을 위해 책정하는 정당한 사용료에요. proof 단위가 많아질수록 조금씩 증가하지만, 보통 proof 개수는 4~5개로 나뉘어 떨어지기 때문에 체감 수수료는 0.03% 수준 아래에 머물러요. 프라이버시가 보장되는 결제 인프라를 운영하려면 서버 비용과 라이트닝 노드 유동성 관리 등 실질적인 비용이 들기 때문에, 이를 충당하기 위한 합리적인 수준의 수수료라고 이해하시면 좋아요.\n\n다만 수수료가 보내는 액수가 아닌 proof 개수로 정해지기 때문에 소액 결제에서는 상대적으로 불리하게 느껴질 수 있어요. 더 자세한 수수료 구조가 궁금하시다면 NUT-04에서 확인해보세요.',
      q5: '지갑 앱을 지우거나 휴대폰을 잃어버리면 잔액이 없어지나요?',
      a5: '네, 그래서 시드 문구 백업이 매우 중요해요. 캐슈 지갑은 은행처럼 중앙 서버가 잔액을 보관해주는 구조가 아니라, 기기 안의 토큰이 곧 잔액이에요. 앱을 삭제하거나 기기를 잃어버리면 안에 있던 토큰도 함께 사라져요. 대부분의 캐슈 지갑은 시드 문구를 제공하며, 이를 통해 결정론적으로 토큰을 복구할 수 있어요. 시드 문구는 반드시 안전한 곳에 따로 보관해주세요.',
      q6: '기존 커스터디와 무엇이 다른가요?',
      a6: '기존의 라이트닝 커스터디 서비스들은 보통 \'잔액\' 개념으로 자금을 관리해요. 사용자별로 계좌에 얼마가 있는지 서버에 기록되기 때문에 운영자가 거래 내역을 쉽게 추적할 수 있고, 그만큼 프라이버시 보호에 취약해요. 특정 사용자의 자금을 동결하거나 거래를 검열하는 것도 어렵지 않아요.\n\n반면 캐슈는 \'토큰\' 개념으로 동작해요. 민트는 토큰을 발행하고 사용 여부만 검증할 뿐, 어떤 토큰을 누가 소유하고 어디로 보냈는지 알 수 있는 방법이 없어요. 그래서 프라이버시가 보호되고 개별 사용자 검열도 사실상 불가능해요. 비록 자금을 민트에 맡기는 커스터디 모델이지만, 프라이버시 측면에서는 한층 더 진화한 형태로 볼 수 있어요.',
    },
    actions: {
      composeInquiry: {
        title: '새로운 문의 작성하기',
        subtitle: '담당 직원이 직접 답변해드려요',
      },
      inquiryList: {
        title: '문의 내역 확인하기',
        subtitle: '총 {{count}} 건의 문의가 있어요',
        subtitleWithUnread: '총 {{count}} 건 · 새 답변 {{unread}} 건이 도착했어요',
      },
      composeIdea: {
        title: '아이디어 제안하기',
        subtitle: '째피팀에게 의견을 들려주세요',
      },
      ideaList: {
        title: '제안 내역 보기',
        subtitle: '총 {{count}} 건의 보낸 제안',
        empty: '아직 보낸 제안이 없어요',
      },
    },
    composeInquirySubtitle: '도움이 필요한 내용을 자세히 설명해주세요. 담당 직원이 빠른 시일 내에 답변드려요.',
    composeIdeaSubtitle: '어떤 점이 더 좋아질 수 있을까요? 째피팀이 꼼꼼히 읽어볼게요.',
    titlePlaceholderInquiry: '어떤 문제가 있는지 짧게 적어주세요',
    titlePlaceholderIdea: '한 줄로 요약해 주세요',
    bodyPlaceholderInquiry: '상세한 내용을 적어주세요. 관련 데이터나 스크린샷을 포함하면 문제 해결 가능성이 높아져요.',
    bodyPlaceholderIdea: '어떤 상황에서 어떤 점이 아쉬웠는지, 어떻게 바뀌면 좋을지 자유롭게 적어 주세요.',
    bodyCounter: '{{count}} / 2000',
    securityNoticeTitle: '복구문구와 PIN 번호는 절대 입력하지 마세요.',
    securityNoticeBody: '째피는 어떤 경우에도 사용자의 개인키 정보를 요구하지 않습니다.',
    attachmentLabel: '파일 첨부',
    attachmentEncryptedNote: '모든 내용은 암호화되어 안전하게 전송됩니다.',
    submitInquiry: '문의 보내기',
    submitIdea: '제안 보내기',
    inquiryListTitle: '내 문의 내역',
    inquiryListSubtitle: '총 {{count}} 건의 열린 문의가 있어요.',
    inquiryListEmpty: '아직 접수된 문의가 없어요.',
    fabNewInquiry: '새 문의',
    fabNewIdea: '새 제안',
    threadFooterInquiry: '이어서 답변하면 같은 스레드에 기록돼요',
    threadFooterIdea: '제안에 대해 자유롭게 이야기를 이어갈 수 있어요',
    detailMetadata: '접수일 {{date}}',
    ideaDetailMetadata: '보낸 일시 {{date}}',
    ideaListTitle: '아이디어 제안 내역',
    ideaListSubtitle: '총 {{count}} 건의 보낸 제안이 있어요.',
    ideaListEmpty: '아직 보낸 제안이 없어요.',
    ideaBadge: '아이디어',
    proposalLabel: '제안',
    composeIdeaPageTitle: '제안하기',
    ideaReplyPlaceholder: '이어서 의견을 들려주세요',
    viewAttachment: '보기',
    openingAttachment: '여는 중',
    openInNewTab: '새 탭에서 열기',
    previewFailed: '미리보기를 열지 못했어요',
    threadStatusEvent: {
      open: '문의가 다시 열렸어요',
      in_progress: '상담사가 답변을 준비 중이에요',
      resolved: '문의가 해결되었어요',
      closed: '문의가 종료되었어요',
    },
  },

  // Settings
  settings: {
    title: '설정',

    // Profile
    profile: '프로필',
    profileDesc: 'Nostr, 라이트닝 주소, 분석',
    profileDescHiddenLightning: 'Nostr, 분석',
    customerSupport: '고객지원',
    customerSupportDesc: '문의 · FAQ · 아이디어 제안',
    lightningAddress: '라이트닝 주소',
    registerLightningAddress: '생성하기',
    registeringLightningAddress: '등록 중...',
    lightningAddressRegistered: 'Lightning Address가 등록되었습니다',
    lightningAddressRegistrationFailed: 'Lightning Address 등록에 실패했습니다',
    changeUsername: '라이트닝 주소 변경',
    currentAddress: '현재 주소',
    newUsername: '새 username',
    usernameAvailable: '사용 가능',
    usernameTaken: '이미 사용 중',
    usernameInvalid: '3-20자, 소문자와 숫자만',
    changeFee: '변경 비용',
    insufficientBalance: '잔액이 부족합니다',
    usernameChanged: 'Username이 변경되었습니다',
    usernameChangeFailed: 'Username 변경에 실패했습니다',
    changingUsername: '변경 중...',
    paymentMint: '결제 민트',
    additionalFeeWarning: '이 민트로 결제 시 소액의 추가 수수료가 발생할 수 있습니다',
    swapFee: '수수료',
    paymentFailed: '결제에 실패했습니다. 다른 민트를 선택해주세요',
    noPayableMint: '변경 비용을 결제할 수 있는 잔액이 충분한 민트가 없습니다',

    // Security
    security: '보안',
    securityDesc: 'PIN 변경, Face ID, 자동 잠금',
    autoLock: '자동 잠금',
    autoLockTimeout: '잠금 시간',
    faceIdTouchId: 'Face ID / Touch ID',
    changePin: 'PIN 변경',

    // Wallet Management
    walletManagement: '지갑 관리',
    walletManagementDesc: '민트, 릴레이, 잔액 확인, 복구문구',
    manageMints: '민트 관리',
    manageRelays: '릴레이 관리',
    mnemonicBackup: '복구문구 확인',

    // TLS Test

    // Logout
    logout: '로그아웃',
    version: 'Zappi v{{version}}',

    updateAvailable: '새 업데이트가 있습니다',
    checkForUpdates: '업데이트 확인',
    updateChecking: '업데이트 확인 중',
    updateInstalling: '신규 버전을 설치 중입니다',
    updateCurrent: '최신 버전입니다',
    updateCheckUnavailable: '이 환경에서는 업데이트를 확인할 수 없습니다',
    updateCheckFailed: '업데이트를 확인하지 못했습니다',

    // Mints
    addMint: '민트 추가',

    // Relays
    relayPlaceholder: 'relay.example.com',
    relayExists: '이미 등록된 릴레이입니다',
    relayConnectionFailed: '릴레이에 연결할 수 없습니다. URL을 확인하세요.',
    maxRelaysReached: '최대 {{max}}개의 릴레이만 추가할 수 있습니다',
    relayDeleteRequired: '릴레이를 더 추가하려면 기존 릴레이를 삭제하세요.',
    nostrRelay: 'Nostr Relay',
    addRelay: '릴레이 추가',
    deleteRelay: '릴레이 삭제',
    confirmDeleteRelay: '삭제하시겠습니까?',
    minRelaysRequired: '최소 {{min}}개의 릴레이가 필요합니다',
    minMintsRequired: '최소 {{min}}개의 민트가 필요합니다',

    // PIN Change
    currentPinLabel: '현재 PIN 입력',
    newPinLabel: '새 PIN 입력 (6자리)',
    confirmPinLabel: '새 PIN 확인',
    pinChangeError: 'PIN이 일치하지 않습니다.',
    wrongCurrentPin: '기존 PIN이 틀렸습니다.',

    // Mnemonic Backup
    enterPinLabel: 'PIN 입력',
    wrongPin: 'PIN이 틀렸습니다.',
    mnemonicWarning: '이 복구문구를 안전하게 보관하세요. 절대 공유하지 마세요.',

    // Logout
    logoutWarning: '모든 데이터가 삭제됩니다. 복구문구를 백업하셨나요?',

    // Token Restore
    currentWalletRecovery: '현재 지갑 잔액 확인',
    externalMnemonicRecovery: '다른 복구문구의 이캐시 가져오기',
    externalMnemonicRecoveryWarning: '입력한 복구문구는 저장되지 않습니다. 등록된 민트에서 찾은 이캐시만 현재 지갑으로 가져옵니다.',
    externalMnemonicPlaceholder: '복구문구 12개 단어',
    externalMnemonicRequired: '복구문구를 입력해주세요.',
    externalMnemonicWordCountRequired: '복구문구 12개 단어를 입력해주세요.',
    fullResync: '릴레이 전체 재동기화',
    fullResyncConfirm: '릴레이에서 전체 수신 내역을 다시 내려받을까요? 시간이 걸릴 수 있어요.',
    fullResyncDone: '재동기화가 완료됐어요.',
    fullResyncFailed: '재동기화에 실패했어요. 다시 시도해주세요.',
    diagnostics: '진단',
    diagnosticsDescription: '문제 해결용 로컬 네트워크 카운터예요. 어디에도 전송되지 않아요 — 지원 요청 시 직접 복사해서 공유하세요.',
    diagnosticsRefresh: '새로고침',
    diagnosticsCopy: '복사',
    diagnosticsCopied: '복사됨',
    diagnosticsCopyFailed: '복사 실패',
    diagnosticsKsNote: '스위치 변경은 다음 잠금 해제부터 적용돼요.',
    startRecovery: '복구 시작',
    restoreDescription: '각 민트에서 미사용 토큰을 검색하여 복원합니다.',
    registeredMints: '등록된 민트: {{count}}개',
    startVerification: '검증 시작',
    verifying: '잔액 검증 중...',
    recoveringLightning: '미결제 Lightning 복구 중...',
    noMissingBalance: '검증 완료. 누락된 잔액이 없습니다.',
    noRecoverableEcash: '복구할 수 있는 이캐시가 없습니다.',
    recoveredAmount: '{{unit}} {{amount}} 복원됨!',
    verificationError: '검증 중 오류가 발생했습니다.',
    noMintsRegistered: '등록된 민트가 없습니다.',

    // Passkey
    passkeyDescription: '생체인증 등록을 위해 PIN을 입력하세요',
    register: '등록하기',
    passkeyRegisterFailed: 'Passkey 등록에 실패했습니다.',
    passkeyPRFNotSupported: '이 기기는 안전한 생체인증 암호화(PRF)를 지원하지 않습니다.',
    passkeyRemoveDescription: '생체인증 해제를 위해 PIN을 입력하세요',
    remove: '해제하기',

    // Mint Delete
    deleteMint: '민트 삭제',
    mintHasBalance: '이 민트에 <bold>{{formattedBalance}}</bold>의 잔액이 있습니다.',
    deleteWarning: '삭제하면 해당 잔액에 접근할 수 없게 됩니다.',
    confirmDeleteMint: '삭제하시겠습니까?',
    primary: '주 항목',
    dragToReorder: '드래그해서 순서 변경',
    reorderHint: '핸들을 드래그해서 순서를 바꿀 수 있어요. 키보드는 핸들에 포커스한 뒤 위/아래 화살표를 누르세요.',

    // Preferences
    preferences: '환경설정',
    preferencesDesc: '언어, 단위, 통화, 프라이버시',

    // Language
    language: '언어',

    // Unit Display
    unitDisplay: '단위 표시',

    // Fiat Currency
    fiatCurrency: '단위',
    showFiatConversion: '법정화폐 표시',

    // POS Management
    posManagement: 'POS 관리',
    addPosDevice: 'POS 디바이스 추가',
    noPosDevices: '등록된 POS 디바이스가 없습니다',
    posProvisioningTitle: 'POS 프로비저닝',
    posProvisioningDescription: 'POS 디바이스에서 이 QR 코드를 스캔하세요.',
    posDeviceLabel: '디바이스 이름',
    posDeviceLabelPlaceholder: '예: 카운터 1',
    posNoLightningAddress: 'POS를 등록하려면 먼저 Lightning Address를 설정하세요.',
    posProvisioningDone: 'POS 디바이스가 성공적으로 등록되었습니다.',
    posDeviceRemove: '디바이스 제거',
    posDeviceRemoveWarning: '이 POS 디바이스는 더 이상 결제를 수취할 수 없습니다. 제거하시겠습니까?',

    // Privacy
    privacy: '프라이버시',
    senderPrivacyMode: '보내기 프라이버시 모드',
    senderPrivacyModeDescription: '수수료가 높더라도 민트가 송수신자를 연결할 수 없는 경로를 선택합니다',

    // Descriptions
    autoLockDescription: '비활동 시 자동으로 잠금',
  },

  // Add Mint Screen
  addMint: {
    title: '민트 추가',
    urlPlaceholder: 'https://mint.example.com',
    worldwide: '전 세계 민트',
    transactions: '거래 {{count}}회',
    alreadyAdded: '이미 추가된 민트입니다.',
    addFailed: '민트 추가에 실패했습니다.',
    validating: '민트 정보 확인 중...',
    adding: '민트 추가 중...',
    restoring: '토큰 복구 확인 중...',
    loading: '민트 목록을 불러오는 중...',
    loadError: '민트 목록을 불러올 수 없습니다.',
    recoveredTokens: '{{amount}}이 복원되었습니다!',
    hasBeenAdded: '이(가) 추가되었습니다.',
    confirmTitle: '이 민트를 추가할까요?',
    confirmAdd: '추가',
  },

  // Scanner
  scanner: {
    title: '스캔',
    paste: '붙여넣기',
    loadFromPhoto: '사진 불러오기',
    validating: '확인 중...',
    unrecognizedFormat: '인식할 수 없는 형식입니다',
    invalidToken: '유효하지 않은 이캐시예요',
    cameraPermission: '카메라 권한이 필요합니다',
    cameraNotFound: '카메라를 찾을 수 없습니다',
    cameraStartFailed: '카메라를 시작할 수 없습니다',
    cameraPreparing: '카메라 준비 중...',
    multipartScanning: '멀티파트 QR 스캔 중...',
    enableCameraPermission: '설정에서 카메라 권한을 허용해주세요',
    uploadImage: '이미지에서 QR 스캔',
    noQrFound: 'QR 코드를 찾을 수 없습니다',
  },

  // Payment Screens
  payment: {
    // Common
    selectMint: '민트 선택',
    selectThisMint: '해당 민트 선택하기',
    insufficientBalance: '잔액 부족',
    maxAmount: '최대: {{amount}}',

    // Lightning Send
    send: '보내기',
    sendFailed: '전송 실패',
    cannotSend: '전송할 수 없는 형식입니다',

    // Lightning Receive

    // Ecash Send

    // Ecash Receive

    // Token Receive

    // Amount Input

    // Zap

    // Nostr DM

    // Token Receive (additional)

    // Lightning Receive (additional)
    createInvoiceFailed: '인보이스 생성 실패',

    // Receive Screen
  },

  // Amount Action Screen
  amountAction: {
    title: '금액 선택',
    send: '보내기',
    receive: '받기',
  },

  // Transfer Screen
  transfer: {
    title: '잔액 이동',
    from: '보내는 민트',
    to: '받는 민트',
    swap: '전송하기',
    swapping: '전송 중...',
    swapFailed: '전송에 실패했습니다',
    sameMintsError: '같은 민트로는 전송할 수 없습니다',
    transferAll: '전액',
    quoting: '견적 확인 중...',
    melting: '출금 중...',
    minting: '입금 중...',
    transferComplete: '이동 완료!',
  },

  // History Screen
  history: {
    title: '거래내역',
    noTransactions: '거래내역이 없습니다',
    all: '전체',
    pending: '대기중',
    today: '오늘',
    yesterday: '어제',
    anchor: {
      today: '{{weekday}} · 오늘',
      yesterday: '{{weekday}} · 어제',
      monthSameYear: '월',
      monthOtherYear: '{{year}}.{{month02}}',
    },
    timeAt: '{{time}}',
    dayWithTime: '{{day}}일 {{time}}',
    endOfList: '모든 거래내역을 확인했어요.',

    // Transaction Types
    lightningReceive: '수신 (라이트닝)',
    lightningSend: '전송 (라이트닝)',
    ecashReceive: '수신 (이캐시)',
    ecashSend: '전송 (이캐시)',
    ecashToken: '생성 (이캐시)',
    ecashRegister: '등록 (이캐시)',
    ecashReclaim: '되찾기 (이캐시)',
    requestFulfill: '이캐시 결제 받음',
    requestPay: '이캐시 결제 보냄',
    nutzap: 'NutZap',
    swap: '스왑',

    // Status
    completed: '완료',
    pendingStatus: '처리 중',
    failedStatus: '실패',

    // Redesigned history screen
    income: '입금',
    expense: '출금',
    filterType: '내역 유형',
    searchPlaceholder: '검색',
    noTransactionsDesc: '거래가 생기면 여기에 표시됩니다',
    period1w: '1주',
    period1m: '1개월',
    period3m: '3개월',
    periodAll: '전체',
    dateFilter: '기간 선택',
    mintFilter: '지갑 선택',
    allMints: '전체 지갑',
    mintCount: '{{count}}개 지갑',

    // Export
    export: '내보내기',
    exportSuccess: '파일이 저장되었습니다',
    exportEmpty: '내보낼 거래내역이 없습니다',
    exportFileName: '거래내역',
    exportCsvDesc: 'Excel, Numbers, Google Sheets에서 열 수 있습니다',
    exportCount: '총 {{count}}건의 거래내역',
    exportDownload: '다운로드',
  },

  // Transaction Detail Screen
  txDetail: {
    type: '유형',
    mint: 'Mint',
    source: '출처',
    memo: '메모',
    failureReason: '실패 사유',
    fee: '수수료',
    destination: '목적지',
    preimage: '결제 증명',
    bolt11: '인보이스',
    quoteId: 'Quote ID',
    fromMint: '출발 Mint',
    toMint: '도착 Mint',
    txId: '거래 ID',
    details: '상세 정보',

    // Sources
    'source.zappi-pos': 'Zappi POS',
    'source.zappi-kiosk': 'Zappi Kiosk',
    'source.zappi-api': 'Zappi API',
    'source.zappi-link': 'Zappi Link',
    'source.wallet': '지갑',
    'source.unknown': '외부',

    // Token lifecycle
    reclaiming: '회수 중...',
    reclaimSuccess: '이캐시를 되찾았습니다',
    reclaimFailed: '이캐시 되찾기 실패',
    consumedByRecipient: '상대방이 이미 수령했습니다',
    sentToken: '이캐시',
    copied: '복사됨',
    delete: '삭제',
    deleteConfirm: '이 거래 기록을 삭제하시겠습니까?',
    deleteWarning: '삭제 후 복구할 수 없습니다.',

    // Context sentences
    receivedToWallet: '{{wallet}}(으)로 받음',
    sentViaLightning: '{{address}}(으)로 보냄',
    sentEcash: '이캐시 전송',
    tokenCreated: '이캐시 생성',
    swappedAt: '{{mint}}에서 스왑',
    swappedFromTo: '{{from}} → {{to}} 스왑',
    receivedFromPOS: '{{name}}에서 받음',
    reclaimAction: '이캐시 되찾기',

    // Section titles
    txInfo: '정보',
    paymentInfo: '결제 정보',
    swapInfo: '스왑 정보',

    // Kiosk order
    orderItems: '주문 내역',
    orderTotal: '합계',

    // Fiat
  },

  // Analytics Screen
  analytics: {
    title: '분석',
    overview: '개요',
    totalReceived: '총 수신',
    totalSent: '총 전송',
    thisWeek: '이번 주',
    thisMonth: '이번 달',
    noData: '데이터가 없습니다',
  },

  // Notifications Screen
  notifications: {
    title: '알림',
    noNotifications: '알림이 없습니다',
    markAllRead: '모두 읽음 처리',
    clearAll: '모두 지우기',
    allCaughtUp: '모든 알림을 확인했습니다!',
    endOfNotifications: '알림 끝',
    paymentReceived: '결제 수신됨',
    paymentSent: '결제 완료',
    tokenReceived: '토큰 수령됨',
    youReceived: '{{amount}} 수신함',
    youSent: '{{amount}} 전송함',
    justNow: '방금',
    minAgo: '{{count}}분 전',
    hourAgo: '{{count}}시간 전',
    hoursAgo: '{{count}}시간 전',
    dayAgo: '{{count}}일 전',
    daysAgo: '{{count}}일 전',
  },

  // PWA Install
  pwa: {
    tagline: 'Bitcoin 결제를 쉽고 빠르게',
    installRequired: '앱 설치가 필요합니다',
    installRequiredDesc: 'ZAPPI는 PWA 앱으로 설치하여 사용해야 합니다.\n오프라인에서도 작동하며 더 빠른 경험을 제공합니다.',
    showInstallInstructions: '설치 방법 보기',
    iosShareButton: 'Safari 하단의 공유 버튼 탭',
    iosFindIcon: '이 아이콘을 찾으세요',
    iosAddToHome: '"홈 화면에 추가" 선택',
    iosScrollFind: '스크롤해서 찾으세요',
    iosAddComplete: '"추가" 탭하여 설치 완료',
    androidOpenMenu: '브라우저 메뉴 열기',
    androidMenuIcon: '우측 상단 점 3개 아이콘',
    androidInstallApp: '"앱 설치" 또는 "홈 화면에 추가" 선택',
    androidFindInMenu: '메뉴에서 찾으세요',
    androidTapInstall: '"설치" 탭하여 완료',
    desktopClickIcon: '주소창 우측의 설치 아이콘 클릭',
    desktopOrMenu: '또는 메뉴에서 "앱 설치"',
    desktopClickInstall: '"설치" 클릭하여 완료',
    desktopBrowserSupport: 'Chrome, Edge, Safari 등 대부분의 브라우저에서 지원됩니다.',
    afterInstall: '설치 후 홈 화면에서 ZAPPI 아이콘을 탭하여 실행하세요.',
    devBypass: '(개발 모드) PWA 없이 계속',
    desktopBrowser: '데스크톱 브라우저',
    guard: {
      subtitle: '비트코인 이캐시 지갑',
      installTitle: '홈 화면에 설치하기',
      installReason: '안전한 결제를 위해 앱 설치가 필요해요',
      installButton: '앱 설치',
      devSkip: '설치 건너뛰기 (개발용)',
      ios: {
        title: 'Safari에서',
        step1: '하단의 공유 버튼을 탭하세요',
        step2: '"홈 화면에 추가"를 선택하세요',
        step3: '오른쪽 위 "추가"를 탭하세요',
      },
      android: {
        title: 'Chrome에서',
        step1: '오른쪽 위 메뉴 아이콘을 탭하세요',
        step2: '"앱 설치" 또는 "홈 화면에 추가"를 선택하세요',
      },
      desktopSafari: {
        title: 'Safari에서',
        step1: '메뉴 막대 > "파일"로 이동하세요',
        step2: '"Dock에 추가..."를 선택하세요',
        footnote: '또는 공유 > Dock에 추가 (Sonoma 이상)',
      },
      desktopEdge: {
        title: 'Edge에서',
        step1: '오른쪽 위 ... 메뉴를 클릭하세요',
        step2: '"앱" > "이 사이트를 앱으로 설치"를 선택하세요',
      },
      desktopChrome: {
        title: 'Chrome에서',
        step1: '오른쪽 위 메뉴 아이콘을 클릭하세요',
        step2: '"저장 및 공유" > "페이지를 앱으로 설치"를 선택하세요',
        footnote: '또는 주소창의 설치 아이콘을 클릭하세요',
      },
    },
  },

  // Errors
  errors: {
    generic: '오류가 발생했습니다.',
    network: '네트워크 연결을 확인하세요.',
    timeout: '요청 시간이 초과되었습니다.',
    unauthorized: '인증이 필요합니다.',
    notFound: '찾을 수 없습니다.',
    serverError: '서버 오류가 발생했습니다.',
    clipboardError: '클립보드를 읽을 수 없습니다.',
    invalidMnemonic: '유효하지 않은 복구문구입니다',
    invalidPassword: '비밀번호가 올바르지 않습니다',
    noWallet: '지갑을 찾을 수 없습니다',
    createWalletFailed: '지갑 생성에 실패했습니다',
    unlockFailed: '잠금 해제에 실패했습니다',
    changePasswordFailed: '비밀번호 변경에 실패했습니다',
    getMnemonicFailed: '복구문구를 가져올 수 없습니다',
    verifyFailed: '인증에 실패했습니다',
    encryptionFailed: '암호화에 실패했습니다',
    decryptionFailed: '복호화에 실패했습니다',
    securityError: '보안 오류가 발생했습니다',
    tokenSpent: '이미 사용된 토큰입니다',
    insufficientBalance: '잔액이 부족해요 (필요: {{required}}  보유: {{available}})',
    insufficientBalanceUnknown: '수수료를 포함하면 잔액이 부족해요',
    insufficientBalanceForFee: '수수료 포함 시 잔액이 부족해요 (필요: {{required}} + 수수료  보유: {{available}})',
    mintConnection: '{{mint}} 민트에 연결할 수 없습니다',
    keysetSyncFailed: '민트 키셋 키를 다운로드할 수 없습니다',
    mintError: '민트에서 오류가 발생했습니다',
    invalidToken: '유효하지 않은 토큰입니다',
    invalidProof: '전송을 처리할 수 없어요. 잠시 후 다시 시도해주세요.',
    quoteNotFound: '결제 요청을 처리할 수 없어요. 다시 시도해주세요.',
    quoteExpired: '결제 요청이 만료되었어요. 다시 시도해주세요.',
    p2pkUnlockFailed: 'P2PK 토큰 언락에 실패했습니다',
    invalidInvoice: '올바르지 않은 Lightning 인보이스입니다',
    invoiceExpired: 'Lightning 인보이스가 만료되었습니다',
    lightningRouting: 'Lightning 결제 경로를 찾을 수 없습니다',
    lightningPayment: 'Lightning 결제에 실패했습니다',
    zappiLinkRegistrationFailed: 'Lightning Address 등록에 실패했습니다',
    zappiLinkNotFound: 'Lightning Address를 찾을 수 없습니다',
    zappiLinkApiError: 'Zappi Link 서비스에 연결할 수 없습니다',
    relayConnection: '릴레이에 연결할 수 없습니다',
    eventPublishFailed: '이벤트 발행에 실패했습니다',
    eventNotFound: '이벤트를 찾을 수 없습니다',
    messageDecryptionFailed: '메시지 복호화에 실패했습니다',
    nip05LookupFailed: 'NIP-05 조회에 실패했습니다',
    invalidSignature: '유효하지 않은 서명입니다',
    networkError: '네트워크 오류가 발생했습니다',
    timeoutError: '요청 시간이 초과되었습니다',
    unknownError: '알 수 없는 오류가 발생했습니다',
    adapterNotFound: '이 작업을 처리할 결제 수단을 찾을 수 없어요',
    serviceNotReady: '서비스를 준비하고 있어요. 잠시 후 다시 시도해 주세요.',
    invalidDestination: '인식할 수 없는 수신 주소예요',
    unrecognizedInput: '인식할 수 없는 입력 형식이에요',
    lnurlParseFailed: '이 LNURL은 처리할 수 없어요',
    transferStateInvalid: '더 이상 처리할 수 없는 전송이에요',
    receiveRequestInvalid: '잘못된 수신 요청이에요',
    supportTicketResolved: '이미 종결된 문의예요',
  },

  // Redirect
  redirect: {
    toReceive: '받기로 이동합니다',
  },

  // Toast Messages
  toast: {
    copied: '클립보드에 복사되었습니다',
    ecashReceivedFromSync: '{{count}}건의 Ecash 결제를 받았습니다 ({{amount}})',
    lightningReceived: '{{unit}} {{amount}} Lightning 결제가 도착했습니다',
    swapOffline: '오프라인 상태에서는 스왑할 수 없습니다',
    balanceLoadFailed: '잔액을 불러오는데 실패했습니다',
    paymentCompleted: '{{amount}} 결제 완료',
    paymentCompletedWithFee: '{{amount}} 결제 완료 (수수료: {{fee}})',
    swapCompleted: '{{amount}} 스왑 완료 (수수료: {{fee}})',
    recoveryCompleted: '{{recovered}}건 복구 완료 ({{failed}}건 실패)',
    ecashTokenReceived: '{{amount}} Ecash 토큰 수신 완료',
    ecashTokenReceivedWithFee: '{{amount}} Ecash 토큰 수신 완료 (수수료: {{fee}})',
    requestFulfilled: '이캐시 결제 {{amount}} 받음',
    noMintsRegistered: '등록된 민트가 없습니다',
    noReachableMints: '연결 가능한 민트가 없습니다',
    mintSwitched: '다른 민트로 전환됨: {{name}}',
    onlineRestored: '온라인 상태로 전환되었습니다',
    offlineStatus: '오프라인 상태입니다',
    transferSettled: '전송 완료',
    transferReclaimed: '전송 회수 완료',
    transferInterrupted: '이전에 중단된 전송이 실패 처리되었어요',
    transferFailed: '전송에 실패했어요',
    tokenClaimed: '토큰 {{amount}} 이 사용되었어요',
    tokenClaimedWithMemo: '토큰 {{amount}} 이 사용되었어요 · {{memo}}',
  },

  // Mint Details
  mintDetails: {
    description: '설명',
    motd: '공지',
    supportedNuts: '지원 NUTs',
    loadError: '민트 정보를 가져올 수 없습니다.',
    deleteMint: '민트 삭제',
  },

  // Send
  send: {
    title: '보내기',
    max: '전액',
    next: '다음',
    noOtherWallets: '다른 지갑이 없습니다',
    myWalletList: '나에게 보내기',
    amountRequired: '금액을 입력해주세요',
    destination: {
      whoToSend: '누구에게 보낼까요?',
      placeholder: '주소 또는 인보이스 입력',
      unrecognized: '인식할 수 없는 주소 형식입니다',
      invalidCashuToken: '유효하지 않은 이캐시 토큰 형식입니다',
      validationFailed: '주소를 확인할 수 없습니다',
      ecashInfoNotFound: 'eCash 수신 정보를 찾을 수 없습니다.',
      noCommonMint: '상대가 받을 수 있는 민트가 없습니다.',
      relayNotFound: '상대에게 보낼 릴레이 정보를 찾을 수 없습니다.',
      selectedMintUnavailable: '{{mint}}은 상대가 받을 수 없습니다. 아래 민트로 보낼 수 있습니다.',
    },
    amount: {
      howMuchSend: '얼마를 보낼까요?',
      prompt: '얼마를 보낼까요?',
      addMemo: '메모 (선택사항)',
      fixedByInvoice: '인보이스에 고정된 금액이에요',
    },
    direct: {
      cta: '직접 전달하기',
      label: '직접 전달',
      createFailed: '토큰 생성에 실패했어요',
      noMint: '사용할 민트가 없어요',
      awaitingClaim: '수령 대기 중',
      claimed: '수령 완료',
    },
    tokenCreate: {
      toggleUnit: '단위 전환 (현재: {{current}})',
      tapToReveal: '탭해서 보기',
      share: '공유',
      reclaim: '되찾기',
      reclaiming: '되찾는 중…',
      reclaimWithFee: '되찾기 (수취 수수료 {{fee}})',
    },
    confirm: {
      title: '보내기 확인',
      question: '<b>{{recipient}}</b>에게\n<amt>{{amount}}</amt>을\n보낼까요?',
      requestQuestion: '<amt>{{amount}}</amt>을\n보낼까요?',
      transferQuestion: '<b>{{target}}</b>으로\n<amt>{{amount}}</amt>을\n옮길까요?',
      createQuestion: '<amt>{{amount}}</amt>\n이캐시를 만들까요?',
      sourceMint: '출금 지갑',
      memo: '메모',
      requestAmount: '요청',
      estimatedFee: '예상 수수료',
      feeChecking: '수수료 확인 중',
      feeUnavailableValue: '확인 불가',
      feeUnavailable: '수수료를 계산하지 못했어요. 다시 시도해 주세요.',
      retryFee: '다시 확인',
      total: '총 차감',
      send: '보내기',
      internalTransfer: '잔액 이동',
      paymentRequest: '결제 요청',
      insufficientWithTotal: '잔액 부족 · 총 {{total}} 필요',
    },
    memo: {
      changeTitle: '메모 변경',
      placeholder: '메모 입력',
      none: '없음',
    },
    sending: {
      title: '보내는 중',
      networkDelay: '네트워크 상황에 따라 시간이 걸릴 수 있어요',
    },
    receipt: {
      title: '보내기 영수증',
      recipient: '받는이',
      sending: '전송 중',
      settling: '정산 확인 중',
      completed: '전송 완료',
      kept: '영수증은 거래내역에 보관돼요',
    },
    complete: {
      title: '보내기 완료',
      confirm: '확인',
    },
  },

  // Receive
  receive: {
    title: '받기',
    qr: {
      title: '받기',
      protocols: {
        unified: '통합',
        cashu: 'Cashu',
        lightning: 'Lightning',
      },
      share: '공유',
    },
    token: {
      title: '토큰 확인',
      receiveMint: '받을 민트',
      receive: '받기',
      reject: '받지 않기',
      netAmount: '실제 수령액',
    },
    untrusted: {
      title: '토큰 확인',
      unregistered: '미등록 민트',
      warningNeedConfirm: '{{amount}}을 받으려면\n확인이 필요해요.',
      addAndReceive: '민트 추가하고 받기',
      addAndReceiveSub: '이 민트를 신뢰해요',
      reject: '받지 않기',
      rejectSub: '이 토큰은 받지 않을게요',
    },
    landing: {
      lightningTab: '라이트닝',
      nostrTab: '노스터 npub',
      receiveAccount: '받을 계좌',
      directReceive: '직접 수령하기',
      specifyAmount: '금액 지정하기',
      noAddress: '아직 받기 주소가 없어요',
      createAddress: '주소 만들기',
    },
    request: {
      summary: '받기 요약',
      expiresIn: '{{seconds}}초 뒤 만료돼요',
      expired: '요청이 만료되었어요',
      regenerate: '새로 만들기',
      makeAnother: '또 만들기',
      exit: '나가기',
    },
    receipt: {
      title: '수령 영수증',
      method: '수단',
      methodLightning: '라이트닝',
      methodEcash: '이캐시',
      toMint: '받는 민트',
      memo: '메모',
      completed: '받기 완료',
      receiving: '수령 확인 중',
    },
    redeem: {
      title: '직접 수령하기',
      photo: '사진 불러오기',
      paste: '붙여넣기',
      confirmSentence: '{{amount}}을 받을까요?',
    },
    tokenReceiveFeeTooHigh: '수령 수수료를 제외하면 받을 금액이 없어 받을 수 없습니다.',
  },

  // Mint Detail Screen
  mintDetail: {
    title: '민트 상세정보',
    pendingItems: '대기중 항목',
    pending: '대기중',
    seeMore: '더보기',
    transactions: '거래내역',
    seeDetails: '더보기',
    ecashToken: '수신 토큰',
    receiveRequest: '받기 요청',
    sentToken: '미수령 토큰',
    expiresIn: '만료 {{time}} 뒤',
    noPendingItems: '대기중인 항목이 없습니다',
    noTransactions: '거래내역이 없습니다',
    // 민트 별칭
    duplicateName: '이미 사용 중인 이름이에요',
    defaultName: '민트 {{number}}',
    // 민트 정보 서브화면
    mintInfo: '민트 정보',
    announcement: '공지',
    description: '설명',
    mintUrl: '민트 URL',
    version: '버전',
    units: '지원 단위',
    supportedProtocols: '지원 프로토콜',
    viewAll: '전체 보기',
    copy: '복사하기',
    copied: '복사됨',
    cardName: '카드 이름',
    cardColor: '카드 색상',
    cardDesign: '카드 디자인',
    cardDesignClassic: '클래식',
    cardDesignModern: '모던',
    emptyAndDelete: '잔액을 비우고 민트를 지우기',
    // 삭제 플로우
    deleteMint: '민트 지우기',
    deleteConfirmMessage: '정말로 민트를 지우시겠어요?',
    balanceRemaining: '{{mint}}에 {{amount}} 이 남아있어요.\n\n잔액을 다른 민트로 보내거나\n다른 사람에게 보낼 수 있어요.',
    emptyMint: '비울 민트',
    fillMint: '채울 민트',
    sendElsewhere: '다른 곳으로 보내기',
    emptyAndDeleteBtn: '비우고 삭제하기',
    forceDeleteBtn: '강제로 삭제하기',
    forceDeleteDescription: '{{mint}}에 남아 있는 {{amount}}은 더 이상 복구할 수 없어요.\n\n정말 강제로 삭제할까요?',
    swapping: '잔액을 이동하는 중...',
    swapFailed: '잔액 이동에 실패했습니다. 다시 시도해주세요.',
    retry: '다시 시도',
    mintDeleted: '민트가 삭제되었습니다.',
    no: '아니요',
    delete: '삭제하기',
    // 대기중 항목 전체화면
    pendingAll: '대기중 항목',
    tabRequest: '요청',
    tabToken: '토큰',
    filterType: '유형',
    search: '검색',
    pendingExpiry: '만료',
    pendingExpired: '만료됨',
  },

  // Pending Item Actions
  pending: {
    redeemAction: '지금 수령',
    redeemSuccess: '토큰을 수령했습니다',
    redeemFailed: '수령에 실패했습니다',
    expiredRemoved: '만료된 요청을 정리했어요',
    reclaimAction: '토큰 회수',
    payment: '결제',
    unified: '통합',
    ecashRequest: 'Ecash 요청',
    lightningInvoice: '라이트닝 인보이스',
    quoteStatus: '상태',
    redeemQuote: '수동 수령',
  },

  // Error Boundary
  error: {
    unexpectedTitle: '예기치 않은 오류가 발생했습니다',
    unexpectedMessage: '앱에 문제가 발생했습니다. 새로고침하여 다시 시도해주세요.',
    reload: '새로고침',
  },

  // Bottom Navigation
  nav: {
    wallet: '지갑',
    token: '이캐시',
    contacts: '주소록',
    settings: '설정',
  },

  // Token tab toolbar
  token: {
    create: '만들기',
    register: '받기',
    empty: {
      title: '만든 이캐시가 없어요.\n이캐시를 만들어 볼까요?',
      footerNote: '이캐시는 현금처럼 작동해요. 가지고 있는 누구나 등록해서 사용할 수 있어요.',
    },
    time: {
      justNow: '방금',
      minutesAgo: '{{count}}분전',
      hoursAgo: '{{count}}시간전',
      yesterday: '어제',
      daysAgo: '{{count}}일전',
      atTimeOfDay: '{{time}}',
      dayWithTime: '{{day}}일 {{time}}',
    },
    pending: {
      timeLabel: '대기중 · {{time}}',
    },
    pendingWidget: {
      title: '대기중',
      summary: '{{count}}개 - 총 {{total}}',
      viewAll: '모두 되찾기',
    },
    pendingEmpty: {
      title: '모두 정리됐어요',
      subtitle: '대기중인 이캐시가 없어요',
    },
    reclaimable: {
      section: '되찾을 수 있어요 ({{count}})',
      actions: {
        reclaim: '되찾기',
        share: '공유',
      },
      shareText: '{{memo}}: {{amount}}',
      copiedToClipboard: '클립보드에 복사되었어요',
    },
    firstCreate: {
      hint: '만들었지만 아직 등록되지 않은 이캐시들이에요.\n상대방이 못 받았거나, 아직 등록 하지 않았을 수 있어요.',
      dismiss: '다시보지않기',
    },
    reclaim: {
      title: '되찾기',
      context: '{{count}}개 이캐시를 되찾아요',
      summaryTotal: '총 이캐시 금액',
      summaryFee: '수취 수수료',
      summaryNet: '받는 금액',
      confirm: '되찾기',
      success: '성공적으로 되찾았습니다',
      failed: '되찾기에 실패했습니다',
    },
    history: {
      section: '내역',
      deleteSuccess: '내역을 삭제했어요',
      deleteFailed: '내역을 삭제하지 못했어요',
      anchor: {
        today: '{{weekday}} · 오늘',
        yesterday: '{{weekday}} · 어제',
        monthSameYear: '월',
        monthOtherYear: '{{year}}.{{month02}}',
      },
      subLine: '{{status}} · {{time}}',
      endOfList: '모든 내역을 확인했어요.',
      status: {
        registered: '등록함',
        consumed: '사용됨',
        reclaimed: '되찾음',
      },
    },
    detail: {
      unread: '안읽은 이캐시',
      title: {
        pending: '대기중인 이캐시',
        registered: '이캐시 등록 완료',
        consumed: '이캐시 사용됨',
        reclaimed: '이캐시 되찾기 완료',
      },
      weekday: {
        sun: '일요일',
        mon: '월요일',
        tue: '화요일',
        wed: '수요일',
        thu: '목요일',
        fri: '금요일',
        sat: '토요일',
      },
      dateLine: {
        pending: '{{year}}년 {{month}}월 {{day}}일 {{weekday}}\n{{time}} 생성됨',
        registered: '{{year}}년 {{month}}월 {{day}}일 {{weekday}}\n{{time}}에 등록함',
        consumed: '{{year}}년 {{month}}월 {{day}}일 {{weekday}}\n{{time}}에 생성함',
        reclaimed: '{{year}}년 {{month}}월 {{day}}일 {{weekday}}\n{{time}}에 되찾음',
      },
      amountLabel: '금액',
      feeLine: '수수료 {{fee}}',
      memoLabel: '메모',
      memoEmpty: '—',
      typeLabel: '유형',
      typeValue: {
        pending: '이캐시 만들기',
        registered: '이캐시 등록',
        consumed: '이캐시 사용됨',
        reclaimed: '이캐시 되찾기',
      },
      mintLabel: {
        pending: '출금 민트',
        registered: '입금 민트',
        consumed: '발행 민트',
        reclaimed: '입금 민트',
      },
      action: {
        forward: '이캐시 전달하기',
        confirm: '이캐시 확인하기',
      },
      actions: {
        qr: 'QR보기',
        copy: '복사하기',
        share: '공유하기',
        viewRaw: '이캐시 원문 보기',
      },
      reclaimCta: '되찾기 (수취 수수료: {{fee}})',
      raw: {
        title: '이캐시 상세보기',
        issuingMint: '발행 민트',
        unit: '단위',
        receiveFee: '수취 수수료',
        empty: '이캐시 데이터가 없습니다.',
        easterEgg: 'ZAPPI X CASHU',
      },
      qr: {
        title: 'QR 공유',
      },
    },
    rawSheet: {
      delete: '내역 삭제',
      deleteConfirm: '내역 삭제?',
      deleting: '삭제 중…',
      yes: '예',
      no: '아니오',
    },
  },

  // Token Register Flow
  tokenRegister: {
    receiving: '받는 중…',
  },

  // Address Book / Contacts
  contacts: {
    title: '주소록',
    addContact: '주소록 추가',
    editContact: '주소록 수정',
    deleteConfirm: '이 주소를 삭제하시겠습니까?',
    name: '이름',
    namePlaceholder: '주소록 이름',
    address: '주소',
    addressPlaceholder: '라이트닝 주소, npub 등',
    nameRequired: '이름을 입력해주세요',
    addressRequired: '주소를 입력해주세요',
    emptyTitle: '아직 주소록이 비어있습니다',
    emptyDescription: '자주 보내는 주소를 저장하세요',
    noResults: '일치하는 주소가 없습니다',
    onlyLightningOrNpub: '라이트닝 주소, npub 또는 nprofile만 등록할 수 있습니다',
    verificationFailed: '주소 확인에 실패했습니다',
    verify: {
      invalidFormat: '올바르지 않은 주소 형식입니다',
      notReachable: '주소에 접근할 수 없습니다',
      invalidNpub: '올바르지 않은 npub 또는 nprofile입니다',
      noNutzapInfo: '이 npub에 NutZap 정보가 없습니다',
      noMints: '이 npub에 등록된 민트가 없습니다',
      noRelay: '이 npub의 릴레이 정보를 찾을 수 없습니다',
      decodeFailed: '주소를 해석할 수 없습니다',
    },
  },
}
