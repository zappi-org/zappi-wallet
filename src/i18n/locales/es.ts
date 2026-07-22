export default {
  // Common
  common: {
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    close: 'Cerrar',
    back: 'Volver',
    save: 'Guardar',
    edit: 'Editar',
    delete: 'Eliminar',
    add: 'Agregar',
    copy: 'Copiar',
    copied: 'Copiado',
    loading: 'Cargando...',
    retry: 'Reintentar',
    send: 'Enviar',
    receive: 'Recibir',
    balance: 'Saldo',
    amount: 'Monto',
    min: 'min',
    offlineRequired: 'Se requiere conexión a Internet',
    paste: 'Pegar',
    change: 'Cambiar',
    search: 'Buscar',
    reset: 'Restablecer',
  },

  // Lock Screen
  lock: {
    enterPin: 'Ingresa tu PIN para desbloquear',
    wrongPin: 'PIN incorrecto. ({{remaining}} intentos restantes)',
    lockedOut: '{{attempts}} intentos fallidos. Intenta en {{minutes}} minutos.',
    tryAgainIn: 'Intenta de nuevo en {{time}}',
    faceIdUnlock: 'Desbloquear con Face ID',
    errorOccurred: 'Ocurrió un error.',
    biometricFailed: 'Autenticación biométrica fallida. Ingresa tu PIN.',
  },

  // Onboarding
  onboarding: {
    // Welcome
    appName: 'Zappi',
    tagline: 'Pagos de Bitcoin fáciles y rápidos',
    createWallet: 'Crear nueva billetera',
    securePrivateFast: 'Seguro • Privado • Rápido',
    invitePlaceholder: 'Código de invitación',
    inviteInvalidCount: 'Código de invitación inválido ({{current}}/{{max}})',
    inviteLocked: 'Demasiados intentos. Intenta de nuevo en 5 minutos.',

    // Mnemonic
    secretRecoveryKey: 'Clave de recuperación secreta',
    mnemonicWarning: 'Esta es la única forma de recuperar tu billetera.\nAnota las palabras en orden y guárdalas en un lugar seguro.',
    copyToClipboard: 'Copiar',
    regenerateMnemonic: 'Generar nueva clave',
    mnemonicSavedConfirm: 'Las he anotado en orden en un lugar seguro',
    recordComplete: 'Siguiente',
    invalidMnemonic: 'Clave de recuperación inválida. Revisa las palabras e intenta de nuevo.',
    backupConfirmRequired: 'Confirma que has anotado tu clave de recuperación.',

    // PIN
    enterNewPin: 'Establece un PIN de 6 dígitos',
    reenterPin: 'Vuelve a ingresar tu PIN',
    pinMismatch: 'Los PIN no coinciden',
    pinDigitsEntered: '{{count}} de {{total}} dígitos del PIN ingresados',

    // Processing
    creatingWallet: 'Creando billetera',
    creatingWalletDesc: 'Creando tu nueva billetera...',
    pleaseWait: 'Por favor espera',

    // Complete
    walletSetupFailed: 'Error al configurar la billetera. Por favor intenta de nuevo.',
  },

  // Home Screen
  home: {
    showBalance: 'Mostrar saldo',
    hideBalance: 'Ocultar saldo',
    addFirstMint: 'Agrega tu primer mint',
    recentTransactions: 'Historial',
    noTransactions: 'Sin transacciones aún',
    seeAll: 'Ver más',
  },

  // Action Buttons
  actions: {
    analytics: 'Análisis',
  },

  support: {
    title: 'Historial de consultas',
    heroTitle: '¿Cómo podemos ayudarte?',
    unavailableTitle: 'El soporte no está configurado',
    unavailableDescription: 'El soporte no está disponible en esta versión. Contacta al equipo de Zappi por el canal oficial.',
    connectionFailed: 'No se pudo conectar con soporte',
    tryAgainLater: 'Inténtalo de nuevo más tarde.',
    composePageTitle: 'Contáctanos',
    requestTitleLabel: 'Título',
    requestBodyLabel: 'Mensaje',
    categoryLabel: 'Tipo',
    categories: {
      transfer: 'Envío / recepción',
      ecash: 'Ecash',
      fee: 'Comisiones',
      security: 'Seguridad / respaldo',
      other: 'Otro',
      general: 'General',
      technical: 'Técnico',
      billing: 'Facturación',
      idea_ux: 'UI / UX',
      idea_feature: 'Nueva función',
      idea_perf: 'Rendimiento / estabilidad',
      idea_other: 'Otro',
    },
    createTicket: 'Enviar',
    submittingTicket: 'Enviando consulta...',
    createFailed: 'No se pudo enviar la consulta',
    sendFailed: 'No se pudo enviar el mensaje',
    unreadBadge: 'NEW',
    noTickets: 'No hay consultas.',
    replyPlaceholder: 'Escribe un mensaje adicional',
    sendMessage: 'Enviar mensaje',
    teamName: 'Equipo Zappi',
    attachFile: 'Adjuntar archivo',
    removeAttachment: 'Quitar adjunto',
    attachmentLimit: 'Puedes adjuntar hasta {{count}} archivos.',
    attachmentTooLarge: 'Los archivos deben ser de {{size}} o menos.',
    attachmentMetadataOnly: 'Cargando información del archivo',
    downloadAttachment: 'Descargar',
    replyToast: 'Hay una nueva respuesta en "{{title}}".',
    leaveTicket: 'Salir',
    deleteTicket: 'Eliminar historial de consulta',
    deleteTitle: '¿Salir de esta consulta?',
    deleted: 'Saliste de la consulta.',
    deleteFailed: 'No se pudo salir de la consulta',
    searchPlaceholder: 'Buscar por palabra clave',
    csStatus: {
      received: 'Recibida',
      progress: 'En curso',
      answered: 'Respondida',
    },
    userBubbleLabel: 'Mi consulta',
    helpHomeSubtitle: 'Pregúntanos lo que quieras, cuando quieras.',
    faqTitle: 'Preguntas frecuentes',
    faqSeeAll: 'Ver todo',
    faq: {
      q1: '¿Qué es un mint?',
      a1: 'Un mint es como un banco en internet. Los mints operan infraestructura de pago Bitcoin como Lightning, gestionando pagos, emisión y canje de ecash. A diferencia de los modelos de custodia tradicionales, los mints de Cashu hacen que sea extremadamente difícil rastrear las transacciones de los usuarios.',
      q2: 'El pago Lightning falló',
      a2: 'Los pagos Lightning pueden fallar por varias razones. Es posible que no se encuentre la ruta hacia el destinatario, o que falle si hay demasiados saltos intermedios. Si los pagos Lightning siguen fallando, es recomendable pedir al mint que revise su configuración.',
      q3: 'El token ecash no se registró',
      a3: 'Un token puede no registrarse si ya fue gastado o si ocurrió un error durante su creación. En ese caso, quien lo creó puede recuperarlo manualmente con la función de verificación de saldo y crear un nuevo token. El registro también puede fallar si el monto del ecash es menor que la tarifa de recepción.',
      q4: '¿Cómo se calculan las tarifas?',
      a4: 'Las tarifas de enrutamiento son un peaje que se paga mientras tu pago Lightning atraviesa múltiples nodos. Varían según la ruta al destino y no pueden ser establecidas por el mint.\n\nLas tarifas de swap son un cargo de servicio establecido por el mint para una operación estable. Aumentan ligeramente con el número de pruebas, pero como los pagos suelen dividirse en 4–5 pruebas, la tarifa efectiva generalmente se mantiene por debajo del 0,03%.\n\nNota: las tarifas se basan en el número de pruebas, no en el monto enviado, por lo que los pagos pequeños pueden sentirse relativamente más caros. Para más detalles, consulta NUT-04.',
      q5: '¿Pierdo mi saldo si borro la app o pierdo el teléfono?',
      a5: 'Sí, por eso hacer una copia de seguridad de tu frase semilla es fundamental. A diferencia de un banco donde un servidor central guarda tu saldo, en una billetera Cashu los tokens en tu dispositivo son tu saldo. Si borras la app o pierdes el dispositivo, los tokens desaparecen también. La mayoría de las billeteras Cashu proporcionan una frase semilla para recuperar los tokens de forma determinista. Guarda siempre tu frase semilla en un lugar seguro.',
      q6: '¿En qué se diferencia de la custodia tradicional?',
      a6: 'Los servicios de custodia Lightning tradicionales gestionan fondos con un modelo de "saldo" — tu saldo se registra en un servidor, lo que facilita que el operador rastree el historial de transacciones y compromete tu privacidad. También es relativamente fácil congelar fondos o censurar transacciones.\n\nCashu funciona con un modelo de "token". El mint solo emite tokens y verifica si fueron gastados — no puede saber quién los tiene ni a dónde fueron enviados. Esto protege la privacidad y hace que la censura individual sea prácticamente imposible. Aunque sigue siendo un modelo de custodia, representa un avance significativo en términos de privacidad.',
    },
    actions: {
      composeInquiry: {
        title: 'Iniciar una nueva consulta',
        subtitle: 'Nuestro equipo te responderá directamente',
      },
      inquiryList: {
        title: 'Ver mis consultas',
        subtitle: '{{count}} consulta(s)',
        subtitleWithUnread: '{{count}} en total · {{unread}} respuesta(s) nueva(s)',
      },
      composeIdea: {
        title: 'Proponer una idea',
        subtitle: 'Comparte tu opinión con el equipo de Zappi',
      },
      ideaList: {
        title: 'Ver mis ideas',
        subtitle: '{{count}} idea(s) enviada(s)',
        empty: 'Aún no has enviado ideas',
      },
    },
    composeInquirySubtitle: 'Cuéntanos los detalles y nuestro equipo te responderá lo antes posible.',
    composeIdeaSubtitle: '¿Qué podría mejorar? El equipo de Zappi lo leerá con atención.',
    titlePlaceholderInquiry: 'Describe brevemente el problema',
    titlePlaceholderIdea: 'Resúmelo en una línea',
    bodyPlaceholderInquiry: 'Agrega detalles. Incluir datos relacionados o capturas de pantalla aumenta la probabilidad de una solución rápida.',
    bodyPlaceholderIdea: 'Cuéntanos en qué momento sentiste que faltaba algo y cómo podría mejorar.',
    bodyCounter: '{{count}} / 2000',
    securityNoticeTitle: 'Nunca compartas tu frase de recuperación ni tu PIN.',
    securityNoticeBody: 'Zappi nunca te pedirá la información de tus claves privadas bajo ninguna circunstancia.',
    attachmentLabel: 'Adjuntos',
    attachmentEncryptedNote: 'Todo se cifra y se envía de forma segura.',
    submitInquiry: 'Enviar consulta',
    submitIdea: 'Enviar idea',
    inquiryListTitle: 'Mis consultas',
    inquiryListSubtitle: '{{count}} consulta(s) abierta(s).',
    inquiryListEmpty: 'Aún no hay consultas.',
    fabNewInquiry: 'Nueva',
    fabNewIdea: 'Nueva',
    threadFooterInquiry: 'Las respuestas se mantienen en el mismo hilo',
    threadFooterIdea: 'Sigue la conversación sobre tu idea',
    detailMetadata: 'Recibida el {{date}}',
    ideaDetailMetadata: 'Enviada el {{date}}',
    ideaListTitle: 'Mis ideas',
    ideaListSubtitle: '{{count}} idea(s) enviada(s).',
    ideaListEmpty: 'Aún no has enviado ideas.',
    ideaBadge: 'Idea',
    proposalLabel: 'Idea',
    composeIdeaPageTitle: 'Proponer una idea',
    ideaReplyPlaceholder: 'Comparte más ideas',
    viewAttachment: 'Ver',
    openingAttachment: 'Abriendo',
    openInNewTab: 'Abrir en una pestaña nueva',
    previewFailed: 'No se pudo abrir la vista previa',
    threadStatusEvent: {
      open: 'Consulta reabierta',
      in_progress: 'El equipo de soporte está preparando una respuesta',
      resolved: 'Esta consulta ha sido resuelta',
      closed: 'Esta consulta ha sido cerrada',
    },
  },

  // Settings
  settings: {
    title: 'Configuración',

    // Profile
    profile: 'Perfil',
    profileDesc: 'Nostr, Dirección Lightning, Análisis',
    profileDescHiddenLightning: 'Nostr, Análisis',
    customerSupport: 'Atención al cliente',
    customerSupportDesc: 'Consultas · FAQ · ideas',
    lightningAddress: 'Dirección Lightning',
    registerLightningAddress: 'Registrar',
    registeringLightningAddress: 'Registrando...',
    lightningAddressRegistered: 'Dirección Lightning registrada',
    lightningAddressRegistrationFailed: 'Error al registrar la dirección Lightning',
    changeUsername: 'Cambiar dirección Lightning',
    currentAddress: 'Dirección actual',
    newUsername: 'Nuevo usuario',
    usernameAvailable: 'Disponible',
    usernameTaken: 'Ya está en uso',
    usernameInvalid: '3-20 caracteres, solo minúsculas y números',
    changeFee: 'Costo del cambio',
    insufficientBalance: 'Saldo insuficiente',
    usernameChanged: 'Usuario cambiado',
    usernameChangeFailed: 'Error al cambiar el usuario',
    changingUsername: 'Cambiando...',
    paymentMint: 'Mint de pago',
    additionalFeeWarning: 'Puede aplicarse una pequeña tarifa adicional al pagar desde este mint',
    swapFee: 'tarifa',
    paymentFailed: 'Pago fallido. Seleccione otro mint',
    noPayableMint: 'Ningún mint tiene saldo suficiente para cubrir la tarifa de cambio',

    // Security
    security: 'Seguridad',
    securityDesc: 'PIN, Face ID, Bloqueo automático',
    autoLock: 'Bloqueo automático',
    autoLockTimeout: 'Bloquear después de',
    faceIdTouchId: 'Face ID / Touch ID',
    changePin: 'Cambiar PIN',

    // Wallet Management
    walletManagement: 'Gestión de billetera',
    walletManagementDesc: 'Mints, Relays, Saldo, Respaldo',
    manageMints: 'Gestionar Mints',
    manageRelays: 'Gestionar Relays',
    mnemonicBackup: 'Ver frase de recuperación',

    // TLS Test

    // Logout
    logout: 'Cerrar sesión',
    version: 'Zappi v{{version}}',

    updateAvailable: 'Actualización disponible',
    checkForUpdates: 'Buscar actualizaciones',
    updateChecking: 'Buscando actualizaciones',
    updateInstalling: 'Instalando la nueva versión',
    updateCurrent: 'Tienes la última versión',
    updateCheckUnavailable: 'La búsqueda de actualizaciones no está disponible aquí',
    updateCheckFailed: 'No se pudieron buscar actualizaciones',

    // Mints
    addMint: 'Agregar Mint',

    // Relays
    relayPlaceholder: 'relay.example.com',
    relayExists: 'El relay ya existe',
    relayConnectionFailed: 'No se pudo conectar al relay. Verifica la URL.',
    maxRelaysReached: 'Máximo de {{max}} relays permitidos',
    relayDeleteRequired: 'Elimina relays existentes para agregar más.',
    nostrRelay: 'Relay Nostr',
    addRelay: 'Agregar Relay',
    deleteRelay: 'Eliminar Relay',
    confirmDeleteRelay: '¿Eliminar este relay?',
    minRelaysRequired: 'Se requieren al menos {{min}} relays',
    minMintsRequired: 'Se requieren al menos {{min}} mints',

    // PIN Change
    currentPinLabel: 'Ingresa PIN actual',
    newPinLabel: 'Ingresa nuevo PIN (6 dígitos)',
    confirmPinLabel: 'Confirma nuevo PIN',
    pinChangeError: 'Los PIN no coinciden.',
    wrongCurrentPin: 'PIN actual incorrecto.',

    // Mnemonic Backup
    enterPinLabel: 'Ingresa PIN',
    wrongPin: 'PIN incorrecto.',
    mnemonicWarning: 'Guarda este mnemónico de forma segura. Nunca lo compartas.',

    // Logout
    logoutWarning: 'Todos los datos serán eliminados. ¿Has respaldado tu mnemónico?',

    // Token Restore
    restoreDescription: 'Buscar y restaurar tokens no usados de cada mint.',
    currentWalletRecovery: 'Recuperar esta billetera',
    externalMnemonicRecovery: 'Importar ecash de otra frase de recuperación',
    externalMnemonicRecoveryWarning: 'La frase de recuperación ingresada no se guarda. Solo el ecash encontrado en mints registrados se moverá a esta billetera.',
    externalMnemonicPlaceholder: '12 palabras de la frase de recuperación',
    externalMnemonicRequired: 'Ingresa una frase de recuperación.',
    externalMnemonicWordCountRequired: 'Ingresa exactamente 12 palabras de la frase de recuperación.',
    fullResync: 'Resincronizar historial de relays',
    fullResyncConfirm: '¿Volver a descargar todo el historial de pagos desde los relays? Puede tardar un poco.',
    fullResyncDone: 'Resincronización completa.',
    fullResyncFailed: 'La resincronización falló. Inténtalo de nuevo.',
    diagnostics: 'Diagnóstico',
    diagnosticsDescription: 'Contadores de red locales para solución de problemas. No se envía nada — cópialos y compártelos manualmente si el soporte lo pide.',
    diagnosticsRefresh: 'Actualizar',
    diagnosticsCopy: 'Copiar',
    diagnosticsCopied: 'Copiado',
    diagnosticsCopyFailed: 'Error al copiar',
    diagnosticsKsNote: 'Los cambios de interruptores se aplican desde el próximo desbloqueo.',
    registeredMints: 'Mints registrados: {{count}}',
    startVerification: 'Iniciar verificación',
    startRecovery: 'Iniciar recuperación',
    verifying: 'Verificando saldo...',
    recoveringLightning: 'Recuperando pagos Lightning pendientes...',
    noMissingBalance: 'Verificación completa. Sin saldo faltante.',
    recoveredAmount: '¡{{unit}} {{amount}} recuperados!',
    noRecoverableEcash: 'No se encontró ecash recuperable.',
    verificationError: 'Ocurrió un error durante la verificación.',
    noMintsRegistered: 'No hay mints registrados.',

    // Passkey
    passkeyDescription: 'Ingresa tu PIN para registrar autenticación biométrica',
    register: 'Registrar',
    passkeyRegisterFailed: 'Error al registrar Passkey.',
    passkeyPRFNotSupported: 'Este dispositivo no admite cifrado biométrico seguro (PRF).',
    passkeyRemoveDescription: 'Ingresa tu PIN para eliminar autenticación biométrica',
    remove: 'Eliminar',

    // Mint Delete
    deleteMint: 'Eliminar Mint',
    mintHasBalance: 'Este mint tiene un saldo de <bold>{{formattedBalance}}</bold>.',
    deleteWarning: 'Eliminar hará el saldo inaccesible.',
    confirmDeleteMint: '¿Eliminar este mint?',
    primary: 'Principal',
    dragToReorder: 'Arrastrar para reordenar',
    reorderHint: 'Arrastra el controlador para reordenar. Con teclado: enfoca el controlador y presiona arriba / abajo.',

    // Preferences
    preferences: 'Preferencias',
    preferencesDesc: 'Idioma, Unidad, Moneda, Privacidad',

    // Language
    language: 'Idioma',

    // Unit Display
    unitDisplay: 'Unidad',

    // Fiat Currency
    fiatCurrency: 'Moneda',
    showFiatConversion: 'Mostrar Precio Fiat',

    // POS Management
    posManagement: 'Gestión de POS',
    addPosDevice: 'Agregar dispositivo POS',
    noPosDevices: 'No hay dispositivos POS registrados',
    posProvisioningTitle: 'Aprovisionamiento POS',
    posProvisioningDescription: 'Escanea este código QR desde el dispositivo POS.',
    posDeviceLabel: 'Nombre del dispositivo',
    posDeviceLabelPlaceholder: 'Ej: Mostrador 1',
    posNoLightningAddress: 'Configura una dirección Lightning primero para registrar dispositivos POS.',
    posProvisioningDone: 'Dispositivo POS registrado exitosamente.',
    posDeviceRemove: 'Eliminar dispositivo',
    posDeviceRemoveWarning: 'Este dispositivo POS ya no podrá aceptar pagos. ¿Eliminar?',

    // Privacy
    privacy: 'Privacidad',
    senderPrivacyMode: 'Modo de privacidad de envío',
    senderPrivacyModeDescription: 'Preferir rutas donde el mint no pueda vincular remitente y destinatario, aunque las tarifas sean mayores',

    // Descriptions
    autoLockDescription: 'Se bloquea tras el tiempo de inactividad que elijas. Reabrir dentro de ese margen omite el PIN.',
  },

  // Add Mint Screen
  addMint: {
    title: 'Agregar Mint',
    urlPlaceholder: 'https://mint.example.com',
    worldwide: 'Mints mundiales',
    transactions: '{{count}} transacciones',
    alreadyAdded: 'Mint ya agregado.',
    addFailed: 'Error al agregar mint.',
    validating: 'Validando mint...',
    adding: 'Agregando mint...',
    restoring: 'Verificando tokens para restaurar...',
    loading: 'Cargando lista de mints...',
    loadError: 'No se pudo cargar la lista de mints.',
    recoveredTokens: '¡{{amount}} recuperados!',
    hasBeenAdded: ' ha sido agregado.',
    confirmTitle: '¿Agregar este mint?',
    confirmAdd: 'Agregar',
  },

  // Scanner
  scanner: {
    title: 'Escanear',
    paste: 'Pegar',
    loadFromPhoto: 'Cargar desde foto',
    unrecognizedFormat: 'Formato no reconocido',
    invalidToken: 'Ecash inválido',
    cameraPermission: 'Se requiere permiso de cámara',
    cameraNotFound: 'Cámara no encontrada',
    cameraStartFailed: 'No se pudo iniciar la cámara',
    cameraPreparing: 'Preparando cámara...',
    multipartScanning: 'Escaneando QR multiparte...',
    enableCameraPermission: 'Habilita el permiso de cámara en la configuración',
    noQrFound: 'No se encontró código QR',
  },

  // Payment Screens
  payment: {
    // Common
    selectMint: 'Seleccionar Mint',
    selectThisMint: 'Seleccionar Este Mint',
    insufficientBalance: 'Saldo insuficiente',
    maxAmount: 'Máx: {{amount}}',

    // Lightning Send
    send: 'Enviar',
    sendFailed: 'Envío fallido',
    cannotSend: 'No se puede enviar a este destino',

    // Lightning Receive

    // Ecash Send

    // Ecash Receive

    // Token Receive

    // Amount Input

    // Zap

    // Nostr DM

    // Other

    // Token Receive (additional)

    // Lightning Receive (additional)
    createInvoiceFailed: 'Error al crear factura',

    // Receive Screen
  },

  // Amount Action Screen
  amountAction: {
    title: 'Seleccionar Acción',
    send: 'Enviar',
    receive: 'Recibir',
  },

  // Transfer Screen
  transfer: {
    title: 'Mover Saldo',
    from: 'Desde Mint',
    to: 'Hacia Mint',
    swap: 'Transferir',
    swapping: 'Transfiriendo...',
    swapFailed: 'Transferencia fallida',
    sameMintsError: 'No se puede transferir al mismo mint',
    transferAll: 'Todo',
    quoting: 'Obteniendo cotización...',
    melting: 'Retirando...',
    minting: 'Depositando...',
    transferComplete: '¡Transferencia completada!',
  },

  // History Screen
  history: {
    title: 'Historial de transacciones',
    noTransactions: 'Sin transacciones aún',
    all: 'Todo',
    pending: 'Pendiente',
    today: 'Hoy',
    yesterday: 'Ayer',
    anchor: {
      today: '{{weekday}} · Hoy',
      yesterday: '{{weekday}} · Ayer',
      monthSameYear: 'Mes',
      monthOtherYear: '{{year}}.{{month02}}',
    },
    timeAt: '{{time}}',
    dayWithTime: '{{day}}, {{time}}',
    endOfList: 'Has revisado todo.',

    // Transaction Types
    lightningReceive: 'Recibir (Lightning)',
    lightningSend: 'Enviar (Lightning)',
    ecashReceive: 'Recibir (eCash)',
    ecashSend: 'Enviar (eCash)',
    ecashToken: 'Crear (eCash)',
    ecashRegister: 'Registrar (eCash)',
    ecashReclaim: 'Recuperar (eCash)',
    requestFulfill: 'Pago Ecash recibido',
    requestPay: 'Pago Ecash enviado',
    nutzap: 'NutZap',
    swap: 'Intercambio',

    // Status
    completed: 'Completado',
    pendingStatus: 'Procesando',
    failedStatus: 'Fallido',

    // Redesigned history screen
    income: 'Ingresos',
    expense: 'Gastos',
    filterType: 'Tipo',
    searchPlaceholder: 'Buscar',
    noTransactionsDesc: 'Las transacciones aparecerán aquí',
    period1w: '1 Sem',
    period1m: '1 Mes',
    period3m: '3 Mes',
    periodAll: 'Todo',
    dateFilter: 'Filtrar por Fecha',
    mintFilter: 'Seleccionar Billetera',
    allMints: 'Todas las Billeteras',
    mintCount: '{{count}} Billeteras',

    // Export
    export: 'Exportar',
    exportSuccess: 'Archivo guardado correctamente',
    exportEmpty: 'No hay transacciones para exportar',
    exportFileName: 'transacciones',
    exportCsvDesc: 'Se abre en Excel, Numbers, Google Sheets',
    exportCount: '{{count}} transacciones',
    exportDownload: 'Descargar',
  },

  // Transaction Detail Screen
  txDetail: {
    type: 'Tipo',
    mint: 'Mint',
    source: 'Origen',
    memo: 'Memo',
    failureReason: 'Motivo del fallo',
    fee: 'Comisión',
    destination: 'Destino',
    preimage: 'Prueba de pago',
    bolt11: 'Factura',
    quoteId: 'Quote ID',
    fromMint: 'Mint de origen',
    toMint: 'Mint de destino',
    txId: 'ID de transacción',
    details: 'Detalles',

    // Sources
    'source.zappi-pos': 'Zappi POS',
    'source.zappi-kiosk': 'Zappi Kiosk',
    'source.zappi-api': 'Zappi API',
    'source.zappi-link': 'Zappi Link',
    'source.wallet': 'Billetera',
    'source.unknown': 'Externo',

    // Token lifecycle
    reclaiming: 'Recuperando...',
    reclaimSuccess: 'eCash recuperado exitosamente',
    reclaimFailed: 'Error al recuperar eCash',
    consumedByRecipient: 'El destinatario ya reclamó este eCash',
    sentToken: 'eCash enviado',
    copied: 'Copiado',
    delete: 'Eliminar',
    deleteConfirm: '¿Eliminar este registro de transacción?',
    deleteWarning: 'No se puede deshacer.',

    // Context sentences
    receivedToWallet: 'Recibido en {{wallet}}',
    sentViaLightning: 'Enviado a {{address}}',
    sentEcash: 'eCash enviado',
    tokenCreated: 'eCash creado',
    swappedAt: 'Intercambiado en {{mint}}',
    swappedFromTo: '{{from}} → {{to}} intercambio',
    receivedFromPOS: 'Recibido de {{name}}',
    reclaimAction: 'Recuperar eCash',

    // Section titles
    txInfo: 'Información',
    paymentInfo: 'Info de pago',
    swapInfo: 'Info de intercambio',

    // Kiosk order
    orderItems: 'Artículos del pedido',
    orderTotal: 'Total',

    // Fiat
  },

  // Analytics Screen
  analytics: {
    title: 'Análisis',
    overview: 'Resumen',
    totalReceived: 'Total recibido',
    totalSent: 'Total enviado',
    thisWeek: 'Esta semana',
    thisMonth: 'Este mes',
    noData: 'Sin datos disponibles',
  },

  // Notifications Screen
  notifications: {
    title: 'Notificaciones',
    noNotifications: 'Sin notificaciones',
    markAllRead: 'Marcar todo como leído',
    clearAll: 'Borrar todo',
    allCaughtUp: '¡Estás al día!',
    endOfNotifications: 'Fin de notificaciones',
    paymentReceived: 'Pago recibido',
    paymentSent: 'Pago enviado',
    tokenReceived: 'Token recibido',
    youReceived: 'Recibiste {{amount}}',
    youSent: 'Enviaste {{amount}}',
    justNow: 'Ahora mismo',
    minAgo: 'hace {{count}} min',
    hourAgo: 'hace {{count}} hora',
    hoursAgo: 'hace {{count}} horas',
    dayAgo: 'hace {{count}} día',
    daysAgo: 'hace {{count}} días',
  },

  // PWA Install
  pwa: {
    tagline: 'Pagos de Bitcoin fáciles y rápidos',
    installRequired: 'Se requiere instalar la app',
    installRequiredDesc: 'ZAPPI necesita instalarse como app PWA.\nFunciona sin conexión y ofrece una experiencia más rápida.',
    showInstallInstructions: 'Mostrar instrucciones de instalación',
    iosShareButton: 'Toca el botón compartir en la parte inferior de Safari',
    iosFindIcon: 'Busca este ícono',
    iosAddToHome: 'Selecciona "Agregar a pantalla de inicio"',
    iosScrollFind: 'Desplázate para encontrarlo',
    iosAddComplete: 'Toca "Agregar" para completar',
    androidOpenMenu: 'Abre el menú del navegador',
    androidMenuIcon: 'Ícono de tres puntos arriba a la derecha',
    androidInstallApp: 'Selecciona "Instalar app" o "Agregar a pantalla de inicio"',
    androidFindInMenu: 'Encuéntralo en el menú',
    androidTapInstall: 'Toca "Instalar" para completar',
    desktopClickIcon: 'Haz clic en el ícono de instalación en la barra de direcciones',
    desktopOrMenu: 'O "Instalar app" desde el menú',
    desktopClickInstall: 'Haz clic en "Instalar" para completar',
    desktopBrowserSupport: 'Compatible con Chrome, Edge, Safari y la mayoría de navegadores.',
    afterInstall: 'Después de instalar, toca el ícono ZAPPI en la pantalla de inicio para abrir.',
    devBypass: '(Modo desarrollo) Continuar sin PWA',
    desktopBrowser: 'Navegador de escritorio',
    guard: {
      subtitle: 'Billetera Bitcoin eCash',
      installTitle: 'Instala en la pantalla de inicio',
      installReason: 'Se requiere instalar la app para pagos seguros',
      installButton: 'Instalar app',
      devSkip: 'Omitir instalación (solo dev)',
      ios: {
        title: 'En Safari',
        step1: 'Toca el botón de compartir en la parte inferior',
        step2: 'Selecciona "Añadir a pantalla de inicio"',
        step3: 'Toca "Añadir" arriba a la derecha',
      },
      android: {
        title: 'En Chrome',
        step1: 'Toca el icono de menú arriba a la derecha',
        step2: 'Selecciona "Instalar app" o "Añadir a pantalla de inicio"',
      },
      desktopSafari: {
        title: 'En Safari',
        step1: 'Ve a la barra de menús > "Archivo"',
        step2: 'Selecciona "Añadir al Dock..."',
        footnote: 'O Compartir > Añadir al Dock (Sonoma+)',
      },
      desktopEdge: {
        title: 'En Edge',
        step1: 'Haz clic en el menú ... arriba a la derecha',
        step2: '"Aplicaciones" > "Instalar este sitio como aplicación"',
      },
      desktopChrome: {
        title: 'En Chrome',
        step1: 'Haz clic en el icono de menú arriba a la derecha',
        step2: '"Guardar y compartir" > "Instalar página como aplicación"',
        footnote: 'O haz clic en el icono de instalar en la barra de direcciones',
      },
    },
  },

  // Errors
  errors: {
    generic: 'Ocurrió un error.',
    network: 'Verifica tu conexión de red.',
    timeout: 'Tiempo de espera agotado.',
    unauthorized: 'Se requiere autenticación.',
    notFound: 'No encontrado.',
    serverError: 'Error del servidor.',
    clipboardError: 'No se puede leer el portapapeles.',
    invalidMnemonic: 'Frase de recuperación inválida',
    invalidPassword: 'Contraseña incorrecta',
    noWallet: 'Billetera no encontrada',
    createWalletFailed: 'Error al crear la billetera',
    unlockFailed: 'Error al desbloquear',
    changePasswordFailed: 'Error al cambiar la contraseña',
    getMnemonicFailed: 'Error al obtener la frase de recuperación',
    verifyFailed: 'Autenticación fallida',
    encryptionFailed: 'Error de encriptación',
    decryptionFailed: 'Error de desencriptación',
    securityError: 'Ocurrió un error de seguridad',
    tokenSpent: 'El token ya fue usado',
    insufficientBalance: 'Saldo insuficiente (necesario: {{required}}  disponible: {{available}})',
    insufficientBalanceUnknown: 'El saldo es insuficiente después de las comisiones',
    insufficientBalanceForFee: 'Saldo insuficiente (necesario: {{required}} + comisión  disponible: {{available}})',
    mintConnection: 'No se puede conectar a {{mint}}',
    keysetSyncFailed: 'No se pudieron descargar las claves del keyset del mint',
    mintError: 'Ocurrió un error en el mint',
    invalidToken: 'Token inválido',
    invalidProof: 'No se pudo procesar la transferencia. Por favor, inténtalo más tarde.',
    quoteNotFound: 'No se pudo procesar la solicitud de pago. Por favor, inténtalo de nuevo.',
    quoteExpired: 'La solicitud de pago ha expirado. Por favor, inténtalo de nuevo.',
    p2pkUnlockFailed: 'Error al desbloquear token P2PK',
    invalidInvoice: 'Factura Lightning inválida',
    invoiceExpired: 'La factura Lightning ha expirado',
    lightningRouting: 'No se encontró una ruta de pago Lightning',
    lightningPayment: 'El pago Lightning falló',
    zappiLinkRegistrationFailed: 'Error al registrar Lightning Address',
    zappiLinkNotFound: 'Lightning Address no encontrada',
    zappiLinkApiError: 'No se puede conectar al servicio Zappi Link',
    relayConnection: 'No se puede conectar al relay',
    eventPublishFailed: 'Error al publicar evento',
    eventNotFound: 'Evento no encontrado',
    messageDecryptionFailed: 'Error al desencriptar mensaje',
    nip05LookupFailed: 'Búsqueda NIP-05 fallida',
    invalidSignature: 'Firma inválida',
    networkError: 'Ocurrió un error de red',
    timeoutError: 'Tiempo de espera agotado',
    unknownError: 'Ocurrió un error desconocido',
    adapterNotFound: 'No hay un método de pago disponible para esta operación',
    serviceNotReady: 'El servicio se está iniciando. Inténtalo de nuevo en un momento.',
    invalidDestination: 'Dirección de destino no reconocida',
    unrecognizedInput: 'Formato de entrada no reconocido',
    lnurlParseFailed: 'No se pudo procesar este LNURL',
    transferStateInvalid: 'Esta transferencia ya no se puede procesar',
    receiveRequestInvalid: 'Solicitud de recepción no válida',
    supportTicketResolved: 'Esta consulta ya está resuelta',
  },

  // Redirect
  redirect: {
    toReceive: 'Cambiando a Recibir',
  },

  // Toast Messages
  toast: {
    copied: 'Copiado al portapapeles',
    ecashReceivedFromSync: '{{count}} pago(s) Ecash recibido(s) ({{amount}})',
    lightningReceived: '{{unit}} {{amount}} pago Lightning recibido',
    swapOffline: 'No se puede intercambiar sin conexión',
    balanceLoadFailed: 'Error al cargar saldo',
    paymentCompleted: '{{amount}} pago completado',
    paymentCompletedWithFee: '{{amount}} pago completado (comisión: {{fee}})',
    swapCompleted: '{{amount}} intercambiado (comisión: {{fee}})',
    recoveryCompleted: '{{recovered}} recuperado(s) ({{failed}} fallido(s))',
    ecashTokenReceived: '{{amount}} token Ecash recibido',
    ecashTokenReceivedWithFee: '{{amount}} token Ecash recibido (comisión: {{fee}})',
    requestFulfilled: 'Pago Ecash {{amount}} recibido',
    noMintsRegistered: 'No hay mints registrados',
    noReachableMints: 'No hay mints accesibles',
    mintSwitched: 'Cambiado al mint: {{name}}',
    onlineRestored: 'Conexión restablecida',
    offlineStatus: 'Estás sin conexión',
    transferSettled: 'Transferencia completada',
    transferReclaimed: 'Transferencia reclamada',
    transferInterrupted: 'Una transferencia interrumpida se marcó como fallida',
    transferFailed: 'La transferencia falló',
    tokenClaimed: 'Tu ecash de {{amount}} fue canjeado',
    tokenClaimedWithMemo: 'Tu ecash de {{amount}} fue canjeado · {{memo}}',
  },

  // Mint Details
  mintDetails: {
    description: 'Descripción',
    motd: 'Anuncio',
    supportedNuts: 'NUTs soportados',
    loadError: 'No se pudo obtener la info del mint.',
    deleteMint: 'Eliminar Mint',
  },

  // Send
  send: {
    title: 'Enviar',
    max: 'Máx',
    next: 'Siguiente',
    noOtherWallets: 'No hay otras billeteras',
    myWalletList: 'Enviarme a mí',
    amountRequired: 'Ingresa un monto',
    destination: {
      whoToSend: '¿A quién enviar?',
      placeholder: 'Dirección o factura',
      unrecognized: 'Formato de dirección no reconocido',
      invalidCashuToken: 'Formato de token Cashu inválido',
      validationFailed: 'No se pudo verificar la dirección',
      ecashInfoNotFound: 'No se encontró información para recibir ecash.',
      noCommonMint: 'No hay ningún mint compartido disponible para este destinatario.',
      relayNotFound: 'No se encontró información de relé para este destinatario.',
      selectedMintUnavailable: '{{mint}} no es compatible con este destinatario. Puedes enviar desde uno de los mints de abajo.',
    },
    amount: {
      prompt: '¿Cuánto quieres enviar?',
      fixedByInvoice: 'Importe fijado por la factura',
    },
    direct: {
      cta: 'Entregar directamente',
      confirmCta: 'Crear',
      label: 'Entrega directa',
      createFailed: 'No se pudo crear el token',
      noMint: 'No hay mint disponible',
      awaitingClaim: 'Esperando cobro',
      claimed: 'Cobrado',
    },
    tokenCreate: {
      toggleUnit: 'Cambiar unidad (actual: {{current}})',
      tapToReveal: 'Tocar para ver',
      share: 'Compartir',
      reclaim: 'Recuperar',
      reclaiming: 'Recuperando…',
      reclaimWithFee: 'Recuperar (comisión {{fee}})',
    },
    confirm: {
      title: 'Confirmar Envío',
      question: '¿Enviar <amt>{{amount}}</amt>\na <b>{{recipient}}</b>?',
      requestQuestion: '¿Enviar <amt>{{amount}}</amt>?',
      transferQuestion: '¿Mover <amt>{{amount}}</amt>\na <b>{{target}}</b>?',
      createQuestion: '¿Crear <amt>{{amount}}</amt>\nen eCash?',
      sourceMint: 'Billetera de Origen',
      memo: 'Memo',
      requestAmount: 'Solicitado',
      estimatedFee: 'Tarifa Estimada',
      fee: 'Tarifa',
      feeChecking: 'Calculando tarifa',
      feeUnavailableValue: 'No disponible',
      feeUnavailable: 'No se pudo estimar la tarifa. Inténtalo de nuevo.',
      retryFee: 'Reintentar',
      total: 'Total',
      send: 'Enviar',
      internalTransfer: 'Transferencia Interna',
      paymentRequest: 'Solicitud de pago',
      insufficientWithTotal: 'Saldo insuficiente · se necesitan {{total}}',
    },
    memo: {
      changeTitle: 'Cambiar nota',
      placeholder: 'Escribe una nota',
      none: 'Ninguna',
    },
    sending: {
      title: 'Enviando',
      networkDelay: 'Puede tomar un momento según la red',
    },
    receipt: {
      title: 'Recibo de envío',
      recipient: 'Para',
      sending: 'Enviando',
      settling: 'Confirmando liquidación',
      completed: 'Completado',
      kept: 'Guardado en tu historial de transacciones',
    },
    complete: {
      title: 'Enviado',
      confirm: 'Listo',
    },
  },

  // Receive
  receive: {
    title: 'Recibir',
    qr: {
      title: 'Recibir',
      protocols: {
        unified: 'Unificado',
        cashu: 'Cashu',
        lightning: 'Lightning',
      },
      share: 'Compartir',
    },
    token: {
      title: 'Confirmación de Token',
      receiveMint: 'Mint de Recepción',
      receive: 'Recibir',
      reject: 'No recibir',
      netAmount: 'Recibes',
    },
    untrusted: {
      title: 'Confirmación de Token',
      unregistered: 'Mint no registrado',
      warningNeedConfirm: 'Para recibir {{amount}},\nse necesita confirmación.',
      addAndReceive: 'Agregar mint y recibir',
      addAndReceiveSub: 'Confío en este mint',
      reject: 'No recibir',
      rejectSub: 'No aceptar este token',
    },
    amount: {
      prompt: '¿Cuánto quieres solicitar?',
    },
    request: {
      summary: 'Resumen de cobro',
      expiresIn: 'Caduca en {{seconds}}s',
      expired: 'La solicitud caducó',
      regenerate: 'Crear una nueva',
      makeAnother: 'Crear otra',
      exit: 'Listo',
    },
    receipt: {
      title: 'RECIBO DE COBRO',
      method: 'Método',
      methodLightning: 'Lightning',
      methodEcash: 'Ecash',
      toMint: 'Mint receptor',
      memo: 'Nota',
      completed: 'Recibido',
      receiving: 'Confirmando',
    },
    redeem: {
      title: 'Canjear un token',
      photo: 'Desde fotos',
      paste: 'Pegar',
      confirmSentence: '¿Recibir {{amount}}?',
    },
    tokenReceiveFeeTooHigh: 'Después de las comisiones de recepción, no queda monto para recibir.',
  },

  myAddress: {
    title: 'Mi dirección',
    lightningTab: 'Lightning',
    nostrTab: 'Npub de Nostr',
    noAddress: 'Aún no tienes dirección',
    createAddress: 'Crear dirección',
    depositsTo: 'Los pagos a esta dirección llegan a {{mint}}',
    depositsToFallback: 'Los pagos llegan a tu mint registrado',
    changeMint: 'Cambiar en ajustes',
  },

  // Mint Detail Screen
  mintDetail: {
    title: 'Detalle del Mint',
    pendingItems: 'Elementos pendientes',
    pending: 'Pendiente',
    transactions: 'Transacciones',
    ecashToken: 'Token Recibido',
    receiveRequest: 'Solicitud de recepción',
    sentToken: 'Token No Reclamado',
    expiresIn: 'Expira en {{time}}',
    noPendingItems: 'No hay elementos pendientes',
    duplicateName: 'Este nombre ya está en uso',
    defaultName: 'Mint {{number}}',
    mintInfo: 'Info del Mint',
    description: 'Descripción',
    mintUrl: 'URL del Mint',
    version: 'Versión',
    units: 'Unidades soportadas',
    supportedProtocols: 'Protocolos soportados',
    viewAll: 'Ver todo',
    copy: 'Copiar',
    copied: 'Copiado',
    cardName: 'Nombre de tarjeta',
    cardColor: 'Color de tarjeta',
    cardDesign: 'Diseño de tarjeta',
    cardDesignClassic: 'Clásico',
    cardDesignModern: 'Moderno',
    emptyAndDelete: 'Vaciar saldo y eliminar mint',
    deleteMint: 'Eliminar Mint',
    deleteConfirmMessage: '¿Seguro que quieres eliminar este mint?',
    balanceRemaining: 'Quedan {{amount}} en {{mint}}.\n\nPuedes enviar el saldo a otro mint o a otra persona.',
    emptyMint: 'Mint a vaciar',
    fillMint: 'Mint destino',
    sendElsewhere: 'Enviar a otro lugar',
    emptyAndDeleteBtn: 'Vaciar y eliminar',
    forceDeleteBtn: 'Eliminar de todos modos',
    forceDeleteDescription: 'Si eliminas {{mint}} ahora, abandonarás el saldo restante de {{amount}} en ese mint.\n\nEsto no se puede deshacer.',
    swapping: 'Moviendo saldo...',
    swapFailed: 'Error al mover el saldo. Inténtelo de nuevo.',
    retry: 'Reintentar',
    mintDeleted: 'El mint ha sido eliminado.',
    no: 'No',
    delete: 'Eliminar',
    pendingAll: 'Elementos pendientes',
    tabRequest: 'Solicitudes',
    tabToken: 'Tokens',
    filterType: 'Tipo',
    search: 'Buscar',
    pendingExpiry: 'Vencimiento',
    pendingExpired: 'Vencido',
  },

  // Pending Item Actions
  pending: {
    redeemAction: 'Canjear ahora',
    redeemSuccess: 'Token canjeado',
    redeemFailed: 'Error al canjear',
    expiredRemoved: 'Solicitud vencida eliminada',
    reclaimAction: 'Recuperar token',
    payment: 'Pago',
    unified: 'Unificado',
    ecashRequest: 'Solicitud Ecash',
    lightningInvoice: 'Factura Lightning',
    quoteStatus: 'Estado',
    redeemQuote: 'Canjear',
  },

  // Error Boundary
  error: {
    unexpectedTitle: 'Algo salió mal',
    unexpectedMessage: 'La app encontró un error inesperado. Recarga para intentar de nuevo.',
    reload: 'Recargar',
  },

  nav: {
    wallet: 'Billetera',
    contacts: 'Contactos',
    settings: 'Ajustes',
  },

  token: {
    time: {
      justNow: 'ahora mismo',
      minutesAgo: 'hace {{count}} min',
      hoursAgo: 'hace {{count}} h',
      yesterday: 'ayer',
      daysAgo: 'hace {{count}} días',
    },
    pending: {
      timeLabel: 'Pendiente · {{time}}',
    },
    pendingWidget: {
      title: 'Pendiente',
      summary: '{{count}} ecash · {{total}}',
      viewAll: 'Ver pendientes',
    },
    reclaimable: {
      section: 'Recuperables ({{count}})',
      actions: {
        reclaim: 'Recuperar',
        share: 'Compartir',
      },
      shareText: '{{memo}}: {{amount}}',
      copiedToClipboard: 'Copiado al portapapeles',
    },
    reclaim: {
      title: 'Recuperar',
      context: 'Recuperando {{count}} ecash',
      summaryTotal: 'Total',
      summaryFee: 'Comisión de recepción',
      summaryNet: 'Recibirás',
      confirm: 'Recuperar',
      success: 'Recuperado exitosamente',
      failed: 'Error al recuperar',
    },
    history: {
      deleteSuccess: 'Historial eliminado',
      deleteFailed: 'No se pudo eliminar el historial',
    },
    detail: {
      unread: 'Ecash no leído',
      title: {
        pending: 'Ecash pendiente',
        registered: 'Ecash registrado',
        consumed: 'Ecash gastado',
        reclaimed: 'Ecash recuperado',
      },
      weekday: {
        sun: 'Domingo',
        mon: 'Lunes',
        tue: 'Martes',
        wed: 'Miércoles',
        thu: 'Jueves',
        fri: 'Viernes',
        sat: 'Sábado',
      },
      dateLine: {
        pending: '{{weekday}}, {{day}}/{{month}}/{{year}}\nCreado a las {{time}}',
        registered: '{{weekday}}, {{day}}/{{month}}/{{year}}\nRegistrado a las {{time}}',
        consumed: '{{weekday}}, {{day}}/{{month}}/{{year}}\nCreado a las {{time}}',
        reclaimed: '{{weekday}}, {{day}}/{{month}}/{{year}}\nRecuperado a las {{time}}',
      },
      amountLabel: 'Cantidad',
      feeLine: 'Comisión {{fee}}',
      memoLabel: 'Nota',
      memoEmpty: '—',
      typeLabel: 'Tipo',
      typeValue: {
        pending: 'Crear ecash',
        registered: 'Registrar ecash',
        consumed: 'Ecash gastado',
        reclaimed: 'Recuperar ecash',
      },
      mintLabel: {
        pending: 'Mint de origen',
        registered: 'Mint de destino',
        consumed: 'Mint emisor',
        reclaimed: 'Mint de destino',
      },
      action: {
        forward: 'Reenviar ecash',
        confirm: 'Ver ecash',
      },
      actions: {
        qr: 'QR',
        copy: 'Copiar',
        share: 'Compartir',
        viewRaw: 'Ver ecash original',
      },
      reclaimCta: 'Recuperar (comisión: {{fee}})',
      raw: {
        title: 'Ecash original',
        issuingMint: 'Mint emisor',
        unit: 'Unidad',
        receiveFee: 'Comisión de recepción',
        empty: 'No hay datos de ecash.',
        easterEgg: 'ZAPPI X CASHU',
      },
      qr: {
        title: 'Compartir QR',
      },
    },
    rawSheet: {
      delete: 'Eliminar historial',
      deleteConfirm: '¿Eliminar historial?',
      deleting: 'Eliminando…',
      yes: 'Sí',
      no: 'No',
    },
  },

  tokenRegister: {
    receiving: 'Recibiendo…',
  },

  contacts: {
    title: 'Contactos',
    addContact: 'Agregar contacto',
    editContact: 'Editar contacto',
    deleteConfirm: '¿Estás seguro de que quieres eliminar este contacto?',
    name: 'Nombre',
    namePlaceholder: 'Nombre del contacto',
    address: 'Dirección',
    addressPlaceholder: 'Dirección Lightning, npub, etc.',
    nameRequired: 'El nombre es obligatorio',
    addressRequired: 'La dirección es obligatoria',
    emptyTitle: 'Aún no hay contactos',
    emptyDescription: 'Guarda direcciones para enviar pagos rápidamente',
    noResults: 'No se encontraron contactos',
    onlyLightningOrNpub: 'Solo se permite dirección Lightning, npub o nprofile',
    verificationFailed: 'Verificación de dirección fallida',
    verify: {
      invalidFormat: 'Formato de dirección inválido',
      notReachable: 'Dirección no accesible',
      invalidNpub: 'npub o nprofile inválido',
      noNutzapInfo: 'NutZap info no encontrado para este npub',
      noMints: 'No hay mints registrados para este npub',
      noRelay: 'No se encontró información de relé para este npub',
      decodeFailed: 'Error al decodificar la dirección',
    },
  },
}
