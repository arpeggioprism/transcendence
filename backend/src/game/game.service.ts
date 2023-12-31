import { Injectable } from '@nestjs/common';
import { GameRepository } from './game.repository';
import { UserService } from 'src/user/user.service';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/user/entity/user.entity';

// Logistic function
const logisticFunction = (p1: number, p2: number): number => {
  return Math.round(25 - 50 / (1 + 10 ** (Math.abs(p1 - p2) / 400)));
};

@Injectable()
export class GameService {
  constructor(
    private userService: UserService,
    private gameRepository: GameRepository,
  ) {}

  async updateGameHistory(
    winId: number,
    loseId: number,
    point1: number,
    point2: number,
  ) {
    const winUser = await this.userService.getProfileByUserId(winId);
    const loseUser = await this.userService.getProfileByUserId(loseId);

    console.log(
      `updateGameHistory winId: ${winId} loseId: ${loseId}, point1:${point1} point2: ${point2}`,
    );
    // 승패 변경
    await this.userService.winGame(winUser.user_id);
    await this.userService.loseGame(loseUser.user_id);

    // 점수 변경
    const surplus = logisticFunction(winUser.point, loseUser.point);
    if (winUser.point > loseUser.point) {
      await this.userService.updateGamePoint(winUser.user_id, 25 - surplus);
      await this.userService.updateGamePoint(loseUser.user_id, -25 + surplus);
    } else {
      await this.userService.updateGamePoint(winUser.user_id, 25 + surplus);
      await this.userService.updateGamePoint(loseUser.user_id, -(25 + surplus));
    }

    // 게임기록 변경
    const newGameHistory1 = await this.gameRepository.createGameHistory(
      winUser,
      winUser.user_id,
      loseUser.user_id,
      winUser.nickname,
      loseUser.nickname,
      point1,
      point2,
    );
    await this.userService.updateGameHistory(winUser.user_id, newGameHistory1);
    const newGameHistory2 = await this.gameRepository.createGameHistory(
      loseUser,
      winUser.user_id,
      loseUser.user_id,
      winUser.nickname,
      loseUser.nickname,
      point1,
      point2,
    );
    await this.userService.updateGameHistory(loseUser.user_id, newGameHistory2);
  }
}
