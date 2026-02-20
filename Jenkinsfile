pipeline {
    agent any

    environment {
        IMAGE_NAME     = 'zappi-wallet'
        IMAGE_TAG      = "build-${env.BUILD_NUMBER}"
        CONTAINER_PORT = '3020'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build') {
            steps {
                sh "docker build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
                sh "docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest"
            }
        }

        stage('Deploy') {
            steps {
                sh """
                    docker compose -p zappi-wallet down || true
                    docker compose -p zappi-wallet up -d
                """
            }
        }
    }

    post {
        failure {
            echo "Build failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
        }
        success {
            echo "Build succeeded: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
        }
        always {
            cleanWs()
        }
    }
}
