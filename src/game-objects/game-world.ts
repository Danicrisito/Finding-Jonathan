import { IInputConfig, IBallConfig, ITableConfig, IVector2, IPhysicsConfig, IAssetsConfig, ILabelsConfig, IMatchScoreConfig, IAIConfig, Score, Prediction } from './../game.config.type';
import { AI, ShotConfigurationDto } from './../ai/ai-trainer';
import { mapRange } from '../common/helper';
import { Referee } from './referee';
import { Player } from './player';
import { Stick } from './stick';
import { Color } from '../common/color';
import { Vector2 } from '../geom/vector2';
import { GameConfig } from '../game.config';
import { Assets } from '../assets';
import { Canvas2D } from '../canvas';
import { Ball } from './ball';
import { Mouse } from '../input/mouse';
import { State } from './state';

//------Configurations------//

const physicsConfig: IPhysicsConfig = GameConfig.physics;
const inputConfig: IInputConfig = GameConfig.input;
const ballConfig: IBallConfig = GameConfig.ball;
const tableConfig: ITableConfig = GameConfig.table;
const labelsConfig: ILabelsConfig = GameConfig.labels;
const matchScoreConfig: IMatchScoreConfig = GameConfig.matchScore;
const aiConfig: IAIConfig = GameConfig.ai;
const gameSize: IVector2 = GameConfig.gameSize;
const sprites: IAssetsConfig = GameConfig.sprites;
const sounds: IAssetsConfig = GameConfig.sounds;

export class GameWorld {

    //------Members------//

    private _stick: Stick;
    private _cueBall: Ball;
    private _8Ball: Ball;
    private _balls: Ball[];
    private _players: Player[] = [new Player(), new Player()];
    private _currentPlayerIndex = 0;
    private _turnState: State;
    private _referee: Referee;
    private _bestShots: Score[];
    private _predictions: Prediction[];
    private _currentBestShot = 0;
    private _currentPrediction = 0;
    private _ballsCollided = false;
    //------Properties------//

    public get currentPlayer(): Player {
        return this._players[this._currentPlayerIndex];
    }

    public get nextPlayer(): Player {
        return this._players[(this._currentPlayerIndex + 1) % this._players.length];
    }

    public get balls(): Ball[] {
        return this._balls
    }

    public get isBallInHand(): boolean {
        return this._turnState.ballInHand;
    }

    public get isTurnValid(): boolean {
        return this._turnState.isValid;
    }

    public get isGameOver(): boolean {
        return this._referee.isGameOver(this.currentPlayer, this._cueBall, this._8Ball);
    }

    public get isBallsMoving(): boolean {
        return this._balls.some(ball => ball.moving);
    }

    public get numOfPocketedBallsOnTurn(): number {
        return this._turnState.pocketedBalls.length;
    }

    //------Constructor------//

    constructor() {
        this.initMatch();
    }

    //------Private Methods------//

    private getBallsByColor(color: Color): Ball[] {
        return this._balls.filter((ball: Ball) => ball.color === color);
    }

    private handleInput(): void {
        if (AI.finishedSession && Mouse.isPressed(inputConfig.mouseShootButton)) {
            this.shootCueBall(this._stick.power, this._stick.rotation);
        }
    }

    private isBallPosOutsideTopBorder(position: Vector2): boolean {
        const topBallEdge: number = position.y - ballConfig.diameter / 2;
        return topBallEdge <= tableConfig.cushionWidth;
    }

    private isBallPosOutsideLeftBorder(position: Vector2): boolean {
        const leftBallEdge: number = position.x - ballConfig.diameter / 2;
        return leftBallEdge <= tableConfig.cushionWidth;
    }

    private isBallPosOutsideRightBorder(position: Vector2): boolean {
        const rightBallEdge: number = position.x + ballConfig.diameter / 2;
        return rightBallEdge >= gameSize.x - tableConfig.cushionWidth;
    }

    private isBallPosOutsideBottomBorder(position: Vector2): boolean {
        const bottomBallEdge: number = position.y + ballConfig.diameter / 2;
        return bottomBallEdge >= gameSize.y - tableConfig.cushionWidth;
    }

    private handleCollisionWithTopCushion(ball: Ball): void {
        ball.position = ball.position.addY(tableConfig.cushionWidth - ball.position.y + ballConfig.diameter / 2);
        ball.velocity = new Vector2(ball.velocity.x, -ball.velocity.y);
    }

    private handleCollisionWithLeftCushion(ball: Ball): void {
        ball.position = ball.position.addX(tableConfig.cushionWidth - ball.position.x + ballConfig.diameter / 2);
        ball.velocity = new Vector2(-ball.velocity.x, ball.velocity.y);
    }

    private handleCollisionWithRightCushion(ball: Ball): void {
        ball.position = ball.position.addX(gameSize.x - tableConfig.cushionWidth - ball.position.x - ballConfig.diameter / 2);
        ball.velocity = new Vector2(-ball.velocity.x, ball.velocity.y);
    }

    private handleCollisionWithBottomCushion(ball: Ball): void {
        ball.position = ball.position.addY(gameSize.y - tableConfig.cushionWidth - ball.position.y - ballConfig.diameter / 2);
        ball.velocity = new Vector2(ball.velocity.x, -ball.velocity.y);
    }

    private resolveBallCollisionWithCushion(ball: Ball): void {

        let collided: boolean = false;

        if (this.isBallPosOutsideTopBorder(ball.nextPosition)) {
            this.handleCollisionWithTopCushion(ball);
            collided = true;
        }
        if (this.isBallPosOutsideLeftBorder(ball.nextPosition)) {
            this.handleCollisionWithLeftCushion(ball);
            collided = true;
        }
        if (this.isBallPosOutsideRightBorder(ball.nextPosition)) {
            this.handleCollisionWithRightCushion(ball);
            collided = true;
        }
        if (this.isBallPosOutsideBottomBorder(ball.nextPosition)) {
            this.handleCollisionWithBottomCushion(ball);
            collided = true;
        }

        if (collided) {
            ball.velocity = ball.velocity.mult(1 - physicsConfig.collisionLoss);
        }
    }

    private resolveBallsCollision(first: Ball, second: Ball): boolean {

        if (!first.visible || !second.visible) {
            return false;
        }

        // Find a normal vector
        const n: Vector2 = first.position.subtract(second.position);

        // Find distance
        const dist: number = n.length;

        if (dist > ballConfig.diameter) {
            return false;
        }

        // Find minimum translation distance
        const mtd = n.mult((ballConfig.diameter - dist) / dist);

        // Push-pull balls apart
        first.position = first.position.add(mtd.mult(0.5));
        second.position = second.position.subtract(mtd.mult(0.5));

        // Find unit normal vector
        const un = n.mult(1 / n.length);

        // Find unit tangent vector
        const ut = new Vector2(-un.y, un.x);

        // Project velocities onto the unit normal and unit tangent vectors
        const v1n: number = un.dot(first.velocity);
        const v1t: number = ut.dot(first.velocity);
        const v2n: number = un.dot(second.velocity);
        const v2t: number = ut.dot(second.velocity);

        // Convert the scalar normal and tangential velocities into vectors
        const v1nTag: Vector2 = un.mult(v2n);
        const v1tTag: Vector2 = ut.mult(v1t);
        const v2nTag: Vector2 = un.mult(v1n);
        const v2tTag: Vector2 = ut.mult(v2t);

        // Update velocities
        first.velocity = v1nTag.add(v1tTag);
        second.velocity = v2nTag.add(v2tTag);

        first.velocity = first.velocity.mult(1 - physicsConfig.collisionLoss);
        second.velocity = second.velocity.mult(1 - physicsConfig.collisionLoss);

        return true;
    }

    private handleCollisions(): void {
        for (let i = 0; i < this._balls.length; i++) {

            this.resolveBallCollisionWithCushion(this._balls[i]);

            for (let j = i + 1; j < this._balls.length; j++) {
                const firstBall = this._balls[i];
                const secondBall = this._balls[j];
                const collided = this.resolveBallsCollision(firstBall, secondBall);

                if (collided) {
                    console.log("collided")
                    this._ballsCollided = true;
                    const force: number = firstBall.velocity.length + secondBall.velocity.length
                    const volume: number = mapRange(force, 0, ballConfig.maxExpectedCollisionForce, 0, 1);
                    Assets.playSound(sounds.paths.ballsCollide, (volume * 0.05));

                    if (!this._turnState.firstCollidedBallColor) {
                        const color: Color = firstBall.color === Color.white ? secondBall.color : firstBall.color;
                        this._turnState.firstCollidedBallColor = color;
                    }
                }
            }
        }
    }

    private isInsidePocket(position: Vector2): boolean {
        return tableConfig.pocketsPositions
            .some((pocketPos: Vector2) => position.distFrom(pocketPos) <= tableConfig.pocketRadius);

    }

    private resolveBallInPocket(ball: Ball): void {

        if (this.isInsidePocket(ball.position)) {
            ball.hide();
        }
    }

    private isValidPlayerColor(color: Color): boolean {
        return color === Color.red || color === Color.yellow;
    }

    private handleBallsInPockets(): void {
        this._balls.forEach((ball: Ball) => {
            this.resolveBallInPocket(ball);
            if (!ball.visible && !this._turnState.pocketedBalls.includes(ball)) {
                Assets.playSound(sounds.paths.rail, 1);
                if (!this.currentPlayer.color && this.isValidPlayerColor(ball.color)) {
                    this.currentPlayer.color = ball.color;
                    this.nextPlayer.color = ball.color === Color.yellow ? Color.red : Color.yellow;
                }
                this._turnState.pocketedBalls.push(ball);
            }
        });
    }

    private handleBallInHand(): void {

        if (Mouse.isPressed(inputConfig.mousePlaceBallButton) && this.isValidPosToPlaceCueBall(Mouse.position)) {
            this.placeBallInHand(Mouse.position);
        }
        else {
            this._stick.movable = false;
            this._stick.visible = false;
            this._cueBall.position = Mouse.position;
        }
    }

    private async handleGameOver(shot_config: ShotConfigurationDto): Promise<void> {
        if (this._turnState.isValid) {
            this.currentPlayer.overallScore++;
        }
        else {
            this.nextPlayer.overallScore++;
        }
        await this.setMatrix(shot_config);

        if (this._bestShots) {
            this.initBestShots();
            return;
        }
        this.initMatch();


    }

    private async nextBestShot(): Promise<void> {

        this.currentPlayer.overallScore = this._bestShots[this._currentBestShot].similarity;
        this.initBestShots();
        this._bestShots = null;
        return;


    }

    private async nextTurn(): Promise<void> {
        const foul = !this._turnState.isValid;

        if (!this._cueBall.visible) {
            this._cueBall.show(Vector2.copy(GameConfig.cueBallPosition));
        }

        if (foul || this._turnState.pocketedBalls.length === 0) {
            this._currentPlayerIndex++;
            this._currentPlayerIndex = this._currentPlayerIndex % this._players.length;
        }

        this._stick.show(this._cueBall.position);

        this._turnState = new State();
        this._turnState.ballInHand = foul;
        let shot_config;


        if (this._bestShots) {
            this.nextBestShot()
            AI.startSessionBestShots(this,
                {
                    power: this._bestShots[this._currentBestShot].shot_configuration.power,
                    rotation: this._bestShots[this._currentBestShot].shot_configuration.rotation
                });
            return;
        }

        if (this.isAITurn()) {
            shot_config = AI.startSession(this);

        }

        if (this.isGameOver) {
            this.handleGameOver(shot_config);
            return;
        }
    }

    private drawCurrentPlayerLabel(): void {

        Canvas2D.drawText(
            labelsConfig.currentPlayer.text + (this._currentPlayerIndex + 1),
            labelsConfig.currentPlayer.font,
            labelsConfig.currentPlayer.color,
            labelsConfig.currentPlayer.position,
            labelsConfig.currentPlayer.alignment
        );
    }

    private drawMatchScores(): void {
        for (let i = 0; i < this._players.length; i++) {
            for (let j = 0; j < this._players[i].matchScore; j++) {
                const scorePosition: Vector2 = Vector2.copy(matchScoreConfig.scoresPositions[i]).addToX(j * matchScoreConfig.unitMargin);
                const scoreSprite: HTMLImageElement = this._players[i].color === Color.red ? Assets.getSprite(sprites.paths.redScore) : Assets.getSprite(sprites.paths.yellowScore);
                Canvas2D.drawImage(scoreSprite, scorePosition);
            }
        }
    }

    private drawOverallScores(): void {
        for (let i = 0; i < this._players.length; i++) {
            Canvas2D.drawText(
                this._players[i].overallScore.toString(),
                labelsConfig.overalScores[i].font,
                labelsConfig.overalScores[i].color,
                labelsConfig.overalScores[i].position,
                labelsConfig.overalScores[i].alignment
            );
        }
    }

    private isInsideTableBoundaries(position: Vector2): boolean {
        let insideTable: boolean = !this.isInsidePocket(position);
        insideTable = insideTable && !this.isBallPosOutsideTopBorder(position);
        insideTable = insideTable && !this.isBallPosOutsideLeftBorder(position);
        insideTable = insideTable && !this.isBallPosOutsideRightBorder(position);
        insideTable = insideTable && !this.isBallPosOutsideBottomBorder(position);

        return insideTable;
    }

    private isAITurn(): boolean {
        //return AI.finishedSession && aiConfig.on && this._currentPlayerIndex === aiConfig.playerIndex;
        return true;
    }
    public async initMatch(): Promise<void> {
        this._ballsCollided = false
        const redBalls: Ball[] = GameConfig.redBallsPositions
            .map((position: Vector2) => new Ball(Vector2.copy(position), Color.white));

        const yellowBalls: Ball[] = GameConfig.yellowBallsPositions
            .map((position: Vector2) => new Ball(Vector2.copy(position), Color.white));

        this._8Ball = new Ball(Vector2.copy(GameConfig.eightBallPosition), Color.white);

        this._cueBall = new Ball(Vector2.copy(GameConfig.cueBallPosition), Color.white);

        this._stick = new Stick(Vector2.copy(GameConfig.cueBallPosition));


        this._balls = [
            ...redBalls,
            ...yellowBalls,
            this._8Ball,
            this._cueBall,
        ];

        this._currentPlayerIndex = 0;

        this._players.forEach((player: Player) => {
            player.matchScore = 0;
            player.color = null;
        });
        this._turnState = new State();
        this._referee = new Referee();

        if (this.isAITurn()) {
            AI.startSession(this);
        }

    }

    public async testPredictions(): Promise<void> {
        const redBalls: Ball[] = GameConfig.redBallsPositions
            .map((position: Vector2) => new Ball(Vector2.copy(position), Color.white));

        const yellowBalls: Ball[] = GameConfig.yellowBallsPositions
            .map((position: Vector2) => new Ball(Vector2.copy(position), Color.white));

        this._8Ball = new Ball(Vector2.copy(GameConfig.eightBallPosition), Color.white);

        this._cueBall = new Ball(Vector2.copy(GameConfig.cueBallPosition), Color.white);

        this._stick = new Stick(Vector2.copy(GameConfig.cueBallPosition));

        this._balls = [
            ...redBalls,
            ...yellowBalls,
            this._8Ball,
            this._cueBall,
        ];

        await this.getPredictions();

        console.log(this._predictions[this._currentPrediction])
        console.log(this._predictions[this._currentPrediction])
        console.log(this._predictions[this._currentPrediction].shot_configuration.rotation)
        console.log(this._predictions[this._currentPrediction]['shot_configuration'].rotation)
        AI.startSessionBestShots(this, {
            power: this._predictions[this._currentPrediction]['shot_configuration'].power,
            rotation: this._predictions[this._currentPrediction]['shot_configuration'].rotation
        });
        this._currentPrediction++;
        if (this._currentPrediction >= this._bestShots.length) {
            this._currentPrediction = 0
        }


    }



    public async initBestShots(): Promise<void> {
        const redBalls: Ball[] = GameConfig.redBallsPositions
            .map((position: Vector2) => new Ball(Vector2.copy(position), Color.white));

        const yellowBalls: Ball[] = GameConfig.yellowBallsPositions
            .map((position: Vector2) => new Ball(Vector2.copy(position), Color.white));

        this._8Ball = new Ball(Vector2.copy(GameConfig.eightBallPosition), Color.white);

        this._cueBall = new Ball(Vector2.copy(GameConfig.cueBallPosition), Color.white);

        this._stick = new Stick(Vector2.copy(GameConfig.cueBallPosition));

        this._balls = [
            ...redBalls,
            ...yellowBalls,
            this._8Ball,
            this._cueBall,
        ];
        console.log("antes if de this.bestshots", this._bestShots)

        await this.getBestShots();


        console.log("preStartSessionBestShots", this._bestShots[this._currentBestShot].shot_configuration.power, this._bestShots[this._currentBestShot].shot_configuration.rotation)
        AI.startSessionBestShots(this, {
            power: this._bestShots[this._currentBestShot].shot_configuration.power,
            rotation: this._bestShots[this._currentBestShot].shot_configuration.rotation
        });
        this._currentBestShot++;
        console.log(this._bestShots)
        console.log(this._bestShots.length)
        if (this._currentBestShot >= this._bestShots.length) {
            this._currentBestShot = 0
        }
    }
    private async getBestShots() {

        // Construir la URL con los parámetros
        const url = new URL('http://localhost:5000/bestShots');

        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();

        console.log(data);
        this._bestShots = data;
        console.log('Resultado recibido desde Python:', this._bestShots);
    }

    public async getPredictions(): Promise<void> {

        // Construir la URL con los parámetros
        const url = new URL('http://localhost:5000/prediction');

        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();

        console.log(data);
        this._predictions = data;
        console.log('Resultado recibido desde Python:', this._bestShots);
    }



    private async getCorrelation(data: any, shot_config: ShotConfigurationDto) {
        console.log("balls collided", this._ballsCollided)

        if (this._ballsCollided) {
            fetch('http://localhost:5000/calculate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    array: data, shot_configuration: {
                        power: shot_config.power,
                        rotation: shot_config.rotation
                    }
                }),
            })
                .then(response => response.json())
                .then(data => {
                    console.log('Resultado recibido desde Python:', data.result);
                    return data.result;
                })
                .catch(error => {
                    console.error('Error:', error);
                });
        }



    }

    private async setMatrix(shot_config: ShotConfigurationDto) {
        const filas = 20; // Swap rows and columns
        const columnas = 37; // Swap rows and columns
        const anchoMesa = 1423;
        const altoMesa = 762;
        const anchoCelda = anchoMesa / columnas;
        const altoCelda = altoMesa / filas;

        let data: (number | null)[][] = new Array(20).fill(0).map(() => new Array(37).fill(0)); //Swap rows and columns 


        for (const ball of this.balls) {
            if (!ball.visible)
                continue;

            const posicionBola = this.calcularPosicionBola(ball.position.x, ball.position.y, anchoCelda, altoCelda);
            if (posicionBola !== null) {
                const [fila, columna] = posicionBola;
                data[fila][columna] = 255; // Marcar la posición como ocupada (o el valor que prefieras)
            }
        }

        this.getCorrelation(data, shot_config);

    }

    private calcularPosicionBola(x: number, y: number, anchoCelda: number, altoCelda: number): [number, number] | null {
        const fila = Math.floor(y / altoCelda);
        const columna = Math.floor(x / anchoCelda);

        if (fila >= 0 && columna >= 0) {
            return [fila, columna];
        } else {
            return null; // La bola está fuera de la matriz
        }
    }



    public isValidPosToPlaceCueBall(position: Vector2): boolean {
        let noOverlap: boolean = this._balls.every((ball: Ball) => {
            return ball.color === Color.white ||
                ball.position.distFrom(position) > ballConfig.diameter;
        })

        return noOverlap && this.isInsideTableBoundaries(position);
    }

    public placeBallInHand(position: Vector2): void {
        this._cueBall.position = position;
        this._turnState.ballInHand = false;
        this._stick.show(this._cueBall.position);
    }

    public concludeTurn(): void {

        this._turnState.pocketedBalls.forEach((ball: Ball) => {
            const ballIndex: number = this._balls.indexOf(ball);
            if (ball.color != Color.white) {
                this._balls.splice(ballIndex, 1);
            }
        });

        if (this.currentPlayer.color) {
            this.currentPlayer.matchScore = 8 - this.getBallsByColor(this.currentPlayer.color).length - this.getBallsByColor(Color.black).length;
        }

        if (this.nextPlayer.color) {
            this.nextPlayer.matchScore = 8 - this.getBallsByColor(this.nextPlayer.color).length - this.getBallsByColor(Color.black).length;
        }

        this._turnState.isValid = this._referee.isValidTurn(this.currentPlayer, this._turnState);
    }

    public shootCueBall(power: number, rotation: number): void {
        if (power > 0) {
            this._stick.rotation = rotation;
            this._stick.shoot();
            this._cueBall.shoot(power, rotation);
            this._stick.movable = false;
            setTimeout(() => this._stick.hide(), GameConfig.timeoutToHideStickAfterShot);
        }
    }

    public nextPrediction(): void {

        if (this.isBallInHand) {
            this.handleBallInHand();
            return;
        }
        this.handleBallsInPockets();
        this.handleCollisions();
        this.handleInput();
        this._stick.update();
        this._balls.forEach((ball: Ball) => ball.update());

        if (!this.isBallsMoving && !this._stick.visible) {

            this.currentPlayer.overallScore = this._bestShots[this._currentBestShot].similarity;
            this.testPredictions();
            return;
        }
    }

    public update(): void {

        if (this.isBallInHand) {
            this.handleBallInHand();
            return;
        }
        this.handleBallsInPockets();
        this.handleCollisions();
        this.handleInput();
        this._stick.update();
        this._balls.forEach((ball: Ball) => ball.update());

        if (!this.isBallsMoving && !this._stick.visible) {
            this.concludeTurn();
            console.log("conclude turn", this._bestShots)

            if (this._bestShots) {
                this.nextBestShot();
                return;
            }

            this.nextTurn();
        }
    }

    public draw(): void {
        Canvas2D.drawImage(Assets.getSprite(sprites.paths.table));
        this.drawCurrentPlayerLabel();
        this.drawMatchScores();
        this.drawOverallScores();
        this._balls.forEach((ball: Ball) => ball.draw());
        this._stick.draw();
    }
}